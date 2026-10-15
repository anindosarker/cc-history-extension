import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CredentialsCache, type Credentials } from "../src/extension/usage/credentials";
import { DEFAULT_DISPLAY_SETTINGS, PAUSED_TEXT, STALE_MARKER, statusModel, waitText } from "../src/extension/usage/format";
import { PollEngine } from "../src/extension/usage/pollEngine";
import {
  LOCK_MAX_AGE_MS,
  MANUAL_MIN_GAP_MS,
  RATE_LIMIT_MAX_MS,
  RATE_LIMIT_MIN_MS,
  manualWaitUntil,
  parseRetryAfter,
  rateLimitDelayMs,
  usageDisabledByEnv,
} from "../src/extension/usage/schedule";
import {
  cacheDecision,
  readUsageCache,
  updateUsageCache,
  usageCachePath,
  writeUsageCache,
  type UsageCacheFile,
} from "../src/extension/usage/sharedCache";
import { UsageError, fetchUsage, type UsageSnapshot } from "../src/extension/usage/usageClient";
import { toUsageView } from "../src/extension/usage/usageView";
import { waitLabel } from "../src/shared/usage";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const MIN = 60_000;
const INTERVAL = 300_000;
const settings = { ...DEFAULT_DISPLAY_SETTINGS, intervalMs: INTERVAL };
const valid = (now: number): Credentials => ({ accessToken: "tok", expiresAt: now + 8 * 3_600_000, source: "keychain" });

function snap(fetchedAt: number, pct = 81): UsageSnapshot {
  return { fetchedAt, fiveHour: { pct }, weekly: { pct: 50 }, scoped: [] };
}

function harness(fetch: () => UsageSnapshot | Error) {
  let now = T0;
  const log: string[] = [];
  const cache = new CredentialsCache(async () => valid(now));
  const engine = new PollEngine({
    readCredentials: (at, o) => cache.get(at, o),
    invalidateCredentials: () => cache.invalidate(),
    fetchUsage: async () => {
      const r = fetch();
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => now,
    log: (line) => log.push(line),
  });
  return { engine, log, advance: (ms: number) => (now += ms), now: () => now };
}

const tooMany = (retryAfterMs?: number) => new UsageError("http", "HTTP 429 Too Many Requests.", 429, retryAfterMs);

describe("429 schedule", () => {
  it("parses Retry-After as seconds or as an HTTP date", () => {
    expect(parseRetryAfter("120", T0)).toBe(120_000);
    expect(parseRetryAfter(" 7 ", T0)).toBe(7_000);
    expect(parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(90_000);
    expect(parseRetryAfter(new Date(T0 - 90_000).toUTCString(), T0)).toBe(0);
    expect(parseRetryAfter("soon", T0)).toBeUndefined();
    expect(parseRetryAfter(null, T0)).toBeUndefined();
  });

  it("waits at least 15 minutes, doubling per consecutive 429 up to two hours, and never less than Retry-After", () => {
    expect(rateLimitDelayMs(undefined, 1)).toBe(RATE_LIMIT_MIN_MS);
    expect(rateLimitDelayMs(undefined, 2)).toBe(30 * MIN);
    expect(rateLimitDelayMs(undefined, 3)).toBe(60 * MIN);
    expect(rateLimitDelayMs(undefined, 4)).toBe(RATE_LIMIT_MAX_MS);
    expect(rateLimitDelayMs(undefined, 9)).toBe(RATE_LIMIT_MAX_MS);
    expect(rateLimitDelayMs(20 * MIN, 1)).toBe(20 * MIN);
    expect(rateLimitDelayMs(5 * MIN, 1)).toBe(RATE_LIMIT_MIN_MS);
    expect(rateLimitDelayMs(5 * 3_600_000, 1)).toBe(RATE_LIMIT_MAX_MS);
  });

  it("backs off without Retry-After and pauses automatic polling after the third 429", async () => {
    const h = harness(() => tooMany());
    const delays: number[] = [];
    const paused: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const out = await h.engine.pollOnce(INTERVAL);
      delays.push(out.delayMs);
      paused.push(out.rateLimited?.paused ?? false);
      expect(out.rateLimited?.consecutive).toBe(i + 1);
      expect(out.rateLimited?.nextAllowedAt).toBe(h.now() + out.delayMs);
      h.advance(out.delayMs);
    }
    expect(delays).toEqual([15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN]);
    expect(paused).toEqual([false, false, true, true]);
    expect(h.engine.state.paused).toBe(true);
    expect(h.engine.state.error).toMatchObject({ reason: "http", status: 429 });
    const logged = h.log.filter((l) => l.includes("HTTP 429"));
    expect(logged).toHaveLength(4);
    expect(logged[0]).toMatch(/HTTP 429 Too Many Requests \(no Retry-After\), 429 #1 in a row, next in 900s$/);
    expect(logged[2]).toMatch(/429 #3 in a row, automatic polling paused until Refresh is clicked/);
    expect(h.log.join("\n")).not.toContain("tok");
  });

  it("honours a longer Retry-After and logs it", async () => {
    const h = harness(() => tooMany(25 * MIN));
    const out = await h.engine.pollOnce(INTERVAL);
    expect(out.delayMs).toBe(25 * MIN);
    expect(h.log[h.log.length - 1]).toMatch(/\(Retry-After 1500s\), 429 #1 in a row, next in 1500s$/);
    const short = harness(() => tooMany(10_000));
    expect((await short.engine.pollOnce(INTERVAL)).delayMs).toBe(RATE_LIMIT_MIN_MS);
  });

  it("reads the Retry-After header off a 429 response", async () => {
    const res = { ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers({ "retry-after": "1800" }) } as unknown as Response;
    const err = await fetchUsage("tok", { version: "t", fetchImpl: async () => res, now: () => T0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).status).toBe(429);
    expect((err as UsageError).retryAfterMs).toBe(1_800_000);
    expect((err as UsageError).rateLimited).toBe(true);
  });

  it("a success clears the 429 streak; a manual resume lifts the pause", async () => {
    let ok = false;
    const h = harness(() => (ok ? snap(h.now()) : tooMany()));
    for (let i = 0; i < 3; i++) await h.engine.pollOnce(INTERVAL);
    expect(h.engine.state.paused).toBe(true);
    h.engine.resume();
    expect(h.engine.state.paused).toBeUndefined();
    ok = true;
    const out = await h.engine.pollOnce(INTERVAL);
    expect(out.rateLimited).toBeUndefined();
    expect(h.engine.consecutiveRateLimits).toBe(0);
    expect(out.state.error).toBeUndefined();
  });

  it("keeps the stale reading with the marker and explains the pause in the tooltip", async () => {
    let ok = true;
    const h = harness(() => (ok ? snap(h.now()) : tooMany()));
    await h.engine.pollOnce(INTERVAL);
    ok = false;
    h.advance(INTERVAL);
    for (let i = 0; i < 3; i++) await h.engine.pollOnce(INTERVAL);
    const m = statusModel(h.engine.state, settings, h.now());
    expect(m.text).toBe(`$(sparkle) 5h 81% · wk 50%${STALE_MARKER}`);
    expect(m.stale).toBe(true);
    expect(m.lines[0]).toBe(PAUSED_TEXT);
    expect(m.lines[2]).toBe("HTTP 429");
    const view = toUsageView(h.engine.state, { sessions: 0, messages: 0, topProjects: [] });
    expect(view.paused).toBe(true);
    expect(view.limits[0].pct).toBe(81);
  });
});

describe("manual refresh rate limit", () => {
  it("allows one manual fetch per minute and reports the wait", () => {
    expect(manualWaitUntil(undefined, T0)).toBeUndefined();
    expect(manualWaitUntil(T0, T0 + 10_000)).toBe(T0 + MANUAL_MIN_GAP_MS);
    expect(manualWaitUntil(T0, T0 + MANUAL_MIN_GAP_MS)).toBeUndefined();
    expect(waitText({ manualWaitUntil: T0 + 42_400 }, T0)).toBe("Please wait 43s");
    expect(waitText({ manualWaitUntil: T0 }, T0)).toBeUndefined();
    expect(waitLabel(T0 + 5_000, T0)).toBe("Please wait 5s");
    const lines = statusModel({ refreshing: false, snapshot: snap(T0), manualWaitUntil: T0 + 30_000 }, settings, T0).lines;
    expect(lines[lines.length - 1]).toBe("Please wait 30s");
    expect(toUsageView({ refreshing: false, manualWaitUntil: T0 + 30_000 }, { sessions: 0, messages: 0, topProjects: [] }).waitUntil).toBe(T0 + 30_000);
  });
});

describe("shared cache decisions", () => {
  const fresh: UsageCacheFile = { fetchedAt: T0 - 2 * MIN, snapshot: snap(T0 - 2 * MIN), plan: "max" };

  it("uses another window's snapshot instead of fetching while it is within the interval", () => {
    expect(cacheDecision({ cache: fresh, now: T0, intervalMs: INTERVAL, manual: false })).toEqual({ action: "use-cache", until: T0 + 3 * MIN });
    expect(cacheDecision({ cache: fresh, now: T0 + 5 * MIN, intervalMs: INTERVAL, manual: false })).toEqual({ action: "fetch" });
    expect(cacheDecision({ cache: undefined, now: T0, intervalMs: INTERVAL, manual: false })).toEqual({ action: "fetch" });
    // This window's own recent snapshot counts too (the cache file may be unwritable).
    expect(cacheDecision({ cache: undefined, now: T0, intervalMs: INTERVAL, manual: false, localFetchedAt: T0 - MIN })).toEqual({
      action: "use-cache",
      until: T0 - MIN + INTERVAL,
    });
  });

  it("lets a manual refresh fetch unless the snapshot is under a minute old", () => {
    expect(cacheDecision({ cache: fresh, now: T0, intervalMs: INTERVAL, manual: true })).toEqual({ action: "fetch" });
    expect(cacheDecision({ cache: { ...fresh, fetchedAt: T0 - 20_000 }, now: T0, intervalMs: INTERVAL, manual: true })).toEqual({
      action: "use-cache",
      until: T0 - 20_000 + INTERVAL,
    });
  });

  it("honours a 429 backoff written by another window, for manual refreshes too", () => {
    const backoff = { ...fresh, nextAllowedAt: T0 + 40 * MIN };
    expect(cacheDecision({ cache: backoff, now: T0 + 10 * MIN, intervalMs: INTERVAL, manual: false })).toEqual({ action: "wait", until: T0 + 40 * MIN });
    expect(cacheDecision({ cache: backoff, now: T0 + 10 * MIN, intervalMs: INTERVAL, manual: true })).toEqual({ action: "wait", until: T0 + 40 * MIN });
    expect(cacheDecision({ cache: backoff, now: T0 + 41 * MIN, intervalMs: INTERVAL, manual: false })).toEqual({ action: "fetch" });
  });

  it("skips while another window's lock is younger than 30 seconds and ignores a stale one", () => {
    const locked = { fetchingSince: T0 - 5_000 };
    expect(cacheDecision({ cache: locked, now: T0, intervalMs: INTERVAL, manual: false })).toEqual({ action: "skip-locked", until: T0 - 5_000 + LOCK_MAX_AGE_MS });
    expect(cacheDecision({ cache: { fetchingSince: T0 - LOCK_MAX_AGE_MS }, now: T0, intervalMs: INTERVAL, manual: false })).toEqual({ action: "fetch" });
    expect(cacheDecision({ cache: { fetchingSince: T0 - 10 * MIN }, now: T0, intervalMs: INTERVAL, manual: false })).toEqual({ action: "fetch" });
  });

  it("adopts a newer cached snapshot and backoff into the engine", async () => {
    const h = harness(() => snap(h.now()));
    expect(h.engine.adopt({ fetchedAt: T0 - MIN, snapshot: snap(T0 - MIN, 33), plan: "max", nextAllowedAt: T0 + MIN })).toBe(true);
    expect(h.engine.state.snapshot?.fiveHour?.pct).toBe(33);
    expect(h.engine.state.plan).toBe("max");
    expect(h.engine.state.nextAllowedAt).toBe(T0 + MIN);
    // An older one changes nothing.
    expect(h.engine.adopt({ fetchedAt: T0 - 2 * MIN, snapshot: snap(T0 - 2 * MIN, 99) })).toBe(false);
    expect(h.engine.state.snapshot?.fiveHour?.pct).toBe(33);
  });
});

describe("shared cache file", () => {
  let home: string;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-usage-cache-"));
  });
  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lives under ~/.cache/cc-history, is written atomically with mode 0600 and round-trips", async () => {
    const file = usageCachePath(home);
    expect(file).toBe(path.join(home, ".cache", "cc-history", "usage.json"));
    expect(await readUsageCache(file)).toBeUndefined();
    await writeUsageCache({ fetchedAt: T0, snapshot: snap(T0), plan: "max" }, file);
    expect(await readUsageCache(file)).toEqual({ fetchedAt: T0, snapshot: snap(T0), plan: "max" });
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    expect(fs.readdirSync(path.dirname(file))).toEqual(["usage.json"]);
    expect(fs.readFileSync(file, "utf8")).not.toContain("tok");
    const updated = await updateUsageCache((c) => ({ ...c, fetchingSince: T0 + 1 }), file);
    expect(updated.fetchedAt).toBe(T0);
    expect((await readUsageCache(file))?.fetchingSince).toBe(T0 + 1);
  });
});

describe("environment guard", () => {
  it("disables polling when CC_HISTORY_DISABLE_USAGE is set to anything but 0 or false", () => {
    expect(usageDisabledByEnv({})).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "" })).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "0" })).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "false" })).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "1" })).toBe(true);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "yes" })).toBe(true);
  });
});
