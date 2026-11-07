import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountWatcher, watchClaudeJson, type ClaudeJsonRead } from "../src/extension/usage/accountWatch";
import { CredentialsCache, parseAccountUuid, tokenDigest, type Credentials } from "../src/extension/usage/credentials";
import { DEFAULT_DISPLAY_SETTINGS, REFRESHING_ICON, statusModel, usableSnapshot } from "../src/extension/usage/format";
import { PollEngine } from "../src/extension/usage/pollEngine";
import { FetchLock, fileLockDeps, type LockDeps } from "../src/extension/usage/fetchLock";
import { LeaderLease, fileLeaseDeps, parseLease, type LeaseDeps } from "../src/extension/usage/leader";
import { nextPollDelay, UsageRefresher, type RefreshSource } from "../src/extension/usage/refresher";
import { FOCUS_STALE_MS, LOCK_MAX_AGE_MS, parseRetryAfter, usageDisabledByEnv } from "../src/extension/usage/schedule";
import {
  cacheDecision,
  readUsageCache,
  updateUsageCache,
  usageCachePath,
  waitForLockRelease,
  writeUsageCache,
  type UsageCacheFile,
} from "../src/extension/usage/sharedCache";
import { UsageError, fetchUsage, type UsageSnapshot } from "../src/extension/usage/usageClient";
import { toUsageView } from "../src/extension/usage/usageView";
import { heldText, paceMarkerText, readingExpired, retryUntilText } from "../src/shared/usage";

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
const MIN = 60_000;
const INTERVAL = 15 * MIN;
const settings = { ...DEFAULT_DISPLAY_SETTINGS, intervalMs: INTERVAL };
const valid = (now: number): Credentials => ({ accessToken: "tok", expiresAt: now + 8 * 3_600_000, source: "keychain" });

function snap(fetchedAt: number, pct = 81): UsageSnapshot {
  return { fetchedAt, fiveHour: { pct }, weekly: { pct: 50 }, scoped: [] };
}

const tooMany = (retryAfterMs?: number) => new UsageError("http", "HTTP 429 Too Many Requests.", 429, retryAfterMs);

/** What several fake windows share: the clock, usage.json, the fetch lock file and the signed-in token. */
interface World {
  now: number;
  cache: UsageCacheFile | undefined;
  lockFile: string | undefined;
  token: string;
  alive: Set<number>;
  /** ~/.claude.json as the account watcher reads it. */
  claudeJson?: ClaudeJsonRead;
}

function newWorld(cache?: UsageCacheFile): World {
  return { now: T0, cache, lockFile: undefined, token: "old", alive: new Set([4242, 99, 77]) };
}

function lockDeps(w: World, pid: number): LockDeps {
  return {
    create: (d) => (w.lockFile !== undefined ? false : ((w.lockFile = d), true)),
    read: () => w.lockFile,
    mtime: () => w.now,
    remove: () => (w.lockFile = undefined),
    now: () => w.now,
    pidAlive: (p) => w.alive.has(p),
    pid,
  };
}

/**
 * One window: a refresher over the shared world and a scripted fetch, which gets the token used and
 * may return a promise so a test can hold a fetch open.
 */
function harness(
  opts: { fetch?: (token: string) => UsageSnapshot | Error | Promise<UsageSnapshot>; cache?: UsageCacheFile; pid?: number } = {},
  w: World = newWorld(opts.cache),
) {
  let fetches = 0;
  let cancelled = false;
  const tokens: string[] = [];
  const log: string[] = [];
  const waits: { id: string; deadline: number }[] = [];
  let otherWindow: () => boolean | Promise<boolean> = () => false;
  const creds = new CredentialsCache(async () => ({ ...valid(w.now), accessToken: w.token }));
  const engine = new PollEngine({
    readCredentials: (at, o) => creds.get(at, o),
    invalidateCredentials: () => creds.invalidate(),
    fetchUsage: async (token) => {
      fetches++;
      tokens.push(token);
      const r = await (opts.fetch ?? (() => snap(w.now)))(token);
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => w.now,
    log: (line) => log.push(line),
  });
  const account = new AccountWatcher({ read: async () => w.claudeJson, onSwitch: () => {}, now: () => w.now, log: () => {} });
  const lock = new FetchLock(lockDeps(w, opts.pid ?? 4242));
  const refresher = new UsageRefresher({
    engine,
    lock,
    readCache: async () => (w.cache ? structuredClone(w.cache) : undefined),
    updateCache: async (change) => {
      const cur = w.cache ? structuredClone(w.cache) : {};
      const next = change(cur);
      const epoch = Math.max(cur.credentialsEpoch ?? 0, next.credentialsEpoch ?? 0);
      w.cache = epoch > 0 ? { ...next, credentialsEpoch: epoch } : next;
    },
    waitForRelease: async (id, deadline) => {
      waits.push({ id, deadline });
      const released = await otherWindow();
      // Giving up means the deadline passed.
      if (!released) w.now = Math.max(w.now, deadline);
      return released;
    },
    cancelled: () => cancelled,
    invalidateCredentials: () => creds.invalidate(),
    tokenChanged: () => creds.tokenChanged(),
    accountSwitchedAt: () => account.takeSwitch(),
    now: () => w.now,
    intervalMs: () => INTERVAL,
    log: (line) => log.push(line),
    onChange: () => {},
  });
  return {
    world: w,
    engine,
    refresher,
    log,
    waits,
    tokens,
    refresh: (s: RefreshSource) => refresher.refresh(s),
    manual: () => refresher.manualRefresh(),
    account,
    fetches: () => fetches,
    cache: () => w.cache,
    setCache: (c: UsageCacheFile | undefined) => (w.cache = c),
    onOtherWindow: (f: () => boolean | Promise<boolean>) => (otherWindow = f),
    cancel: () => (cancelled = true),
    advance: (ms: number) => (w.now += ms),
    now: () => w.now,
  };
}

/** A fetch the test releases by hand. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("manual refresh", () => {
  it("always fetches, even right after another fetch, and leaves no lock behind", async () => {
    const h = harness();
    await h.refresh("manual");
    h.advance(5_000);
    await h.refresh("manual");
    h.advance(1_000);
    await h.refresh("manual");
    expect(h.fetches()).toBe(3);
    expect(h.engine.state.snapshot?.fetchedAt).toBe(T0 + 6_000);
    expect(h.cache()?.fetchedAt).toBe(T0 + 6_000);
    expect(h.world.lockFile).toBeUndefined();
  });

  it("joins the run in flight instead of starting another", async () => {
    const g = gate();
    const h = harness({ fetch: () => g.opened.then(() => snap(h.now())) });
    const a = h.refresh("manual");
    const b = h.refresh("manual");
    const c = h.refresh("auto");
    expect(h.engine.state.refreshing).toBe(true);
    g.open();
    await Promise.all([a, b, c]);
    expect(h.fetches()).toBe(1);
    expect(h.engine.state.refreshing).toBe(false);
  });

  it("follows a background check that decided not to fetch", async () => {
    const h = harness({ cache: { fetchedAt: T0 - MIN, snapshot: snap(T0 - MIN), attemptedAt: T0 - MIN } });
    const auto = h.refresh("auto");
    const manual = h.refresh("manual");
    await Promise.all([auto, manual]);
    expect(h.fetches()).toBe(1);
  });

  it("waits for the window holding the lock and shows its result without fetching", async () => {
    const h = harness({ cache: { fetchedAt: T0 - 20 * MIN, snapshot: snap(T0 - 20 * MIN, 10) } });
    const other = new FetchLock(lockDeps(h.world, 99));
    const held = other.tryAcquire()!;
    h.onOtherWindow(() => {
      h.setCache({ fetchedAt: T0 + 1_000, snapshot: snap(T0 + 1_000, 42), attemptedAt: T0 + 1_000 });
      other.release(held);
      return true;
    });
    await h.refresh("manual");
    expect(h.waits).toEqual([{ id: held.id, deadline: held.at + LOCK_MAX_AGE_MS }]);
    expect(h.fetches()).toBe(0);
    expect(h.engine.state.snapshot?.fiveHour?.pct).toBe(42);
    expect(h.engine.state.snapshot?.fetchedAt).toBe(T0 + 1_000);
  });

  it("shows the other window's failure too", async () => {
    const h = harness({ cache: { fetchedAt: T0 - 20 * MIN, snapshot: snap(T0 - 20 * MIN) } });
    const other = new FetchLock(lockDeps(h.world, 99));
    const held = other.tryAcquire()!;
    h.onOtherWindow(() => {
      h.setCache({
        fetchedAt: T0 - 20 * MIN,
        snapshot: snap(T0 - 20 * MIN),
        lastError: { reason: "http", message: "HTTP 503.", status: 503, at: T0 + 500 },
        attemptedAt: T0 + 500,
      });
      other.release(held);
      return true;
    });
    await h.refresh("manual");
    expect(h.fetches()).toBe(0);
    expect(h.engine.state.error).toMatchObject({ status: 503, at: T0 + 500 });
  });

  it("takes the lock before fetching itself when the other window does not answer in time", async () => {
    const w = newWorld();
    const other = new FetchLock(lockDeps(w, 99));
    const held = other.tryAcquire()!;
    let lockDuringFetch: string | undefined;
    const h = harness({ fetch: () => ((lockDuringFetch = w.lockFile), snap(w.now)) }, w);
    h.onOtherWindow(() => false);
    await h.refresh("manual");
    expect(h.waits).toHaveLength(1);
    expect(h.fetches()).toBe(1);
    expect(JSON.parse(lockDuringFetch!)).toMatchObject({ pid: 4242 });
    // The late holder's release does not delete a lock it no longer holds.
    const mine = new FetchLock(lockDeps(w, 4242)).tryAcquire()!;
    other.release(held);
    expect(JSON.parse(w.lockFile!).id).toBe(mine.id);
  });

  it("does not record an attempt the other window never made, and fetches itself", async () => {
    const h = harness({ cache: { fetchedAt: T0 - 20 * MIN, snapshot: snap(T0 - 20 * MIN) } });
    const other = new FetchLock(lockDeps(h.world, 99));
    const held = other.tryAcquire()!;
    h.onOtherWindow(() => (other.release(held), true));
    await h.refresh("manual");
    expect(h.fetches()).toBe(1);
  });

  it("stops waiting and writes nothing once the window is closing", async () => {
    const h = harness({ cache: { fetchedAt: T0 - 20 * MIN, snapshot: snap(T0 - 20 * MIN) } });
    const other = new FetchLock(lockDeps(h.world, 99));
    other.tryAcquire();
    h.onOtherWindow(() => (h.cancel(), false));
    const before = structuredClone(h.cache());
    await h.refresh("manual");
    expect(h.fetches()).toBe(0);
    expect(h.cache()).toEqual(before);
  });

  it("is refused only while rate limited after a 429, and an account switch ignores it", async () => {
    const h = harness({ fetch: () => tooMany(40 * MIN) });
    await h.refresh("manual");
    expect(h.engine.state.retryUntil).toBe(T0 + 40 * MIN);
    h.advance(MIN);
    await h.refresh("manual");
    expect(h.fetches()).toBe(1);
    expect(h.log.some((l) => l.includes("manual refresh refused"))).toBe(true);
    expect(retryUntilText(h.engine.state.retryUntil, h.now(), { locale: "en-US" })).toMatch(/^Rate limited until /);
    await h.refresher.switchAccount();
    await h.refresh("manual");
    expect(h.fetches()).toBe(2);
  });
});
describe("429 handling", () => {
  it("parses Retry-After as seconds or as an HTTP date", () => {
    expect(parseRetryAfter("120", T0)).toBe(120_000);
    expect(parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(90_000);
    expect(parseRetryAfter(new Date(T0 - 90_000).toUTCString(), T0)).toBe(0);
    expect(parseRetryAfter("soon", T0)).toBeUndefined();
    expect(parseRetryAfter(null, T0)).toBeUndefined();
  });

  it("reads the Retry-After header off a 429 response", async () => {
    const res = { ok: false, status: 429, statusText: "Too Many Requests", headers: new Headers({ "retry-after": "1800" }) } as unknown as Response;
    const err = await fetchUsage("tok", { version: "t", fetchImpl: async () => res, now: () => T0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).retryAfterMs).toBe(1_800_000);
  });

  it("holds the last good snapshot, marks it rate limited and tries again after max(Retry-After, interval)", async () => {
    const next: { fail?: Error } = {};
    const h = harness({ fetch: () => next.fail ?? snap(h.now()) });
    await h.refresh("manual");
    h.advance(12 * MIN);
    next.fail = tooMany(40 * MIN);
    await h.refresh("manual");
    expect(h.engine.state.snapshot?.fetchedAt).toBe(T0);
    expect(h.engine.state.error?.status).toBe(429);
    expect(h.refresher.nextDelayMs).toBe(40 * MIN);
    expect(h.cache()).toMatchObject({ fetchedAt: T0, retryUntil: T0 + 52 * MIN, attemptedAt: T0 + 12 * MIN });
    expect(heldText(h.engine.state.error, h.engine.state.snapshot?.fetchedAt, h.now())).toBe("Rate limited, showing numbers from 12m ago");
    const m = statusModel(h.engine.state, settings, h.now());
    expect(m.text).toBe("$(sparkle) 5h 81% · wk 50%");
    expect(m.lines[0]).toBe("Rate limited, showing numbers from 12m ago");
    expect(m.lines[1]).toMatch(/^Rate limited until /);
    expect(toUsageView(h.engine.state, undefined, h.now())).toMatchObject({ fetchedAt: T0, retryUntil: T0 + 52 * MIN, error: { status: 429 } });
    expect(h.log.some((l) => /HTTP 429 Too Many Requests \(Retry-After 2400s\), keeping the last numbers, next in 2400s$/.test(l))).toBe(true);
  });

  it("without Retry-After still holds every window for a minute, then waits one interval", async () => {
    const h = harness({ fetch: () => tooMany() });
    await h.refresh("manual");
    expect(h.refresher.nextDelayMs).toBe(INTERVAL);
    expect(h.engine.state.retryUntil).toBe(T0 + 60_000);
    expect(h.cache()?.retryUntil).toBe(T0 + 60_000);
    await h.refresh("manual");
    expect(h.fetches()).toBe(1);
    // Another window honours the same hold through usage.json.
    const other = harness({ pid: 99 }, h.world);
    await other.refresh("manual");
    expect(other.fetches()).toBe(0);
    expect(other.engine.state.retryUntil).toBe(T0 + 60_000);
    h.advance(61_000);
    await h.refresh("manual");
    expect(h.fetches()).toBe(2);
    // Timers space themselves from the failed attempt instead of fetching again.
    await h.refresh("auto");
    expect(h.fetches()).toBe(2);
  });

  it("never moves a rate limit backwards when another window set a longer one", async () => {
    const h = harness({ fetch: () => ((h.world.cache = { ...h.world.cache, retryUntil: T0 + 40 * MIN }), tooMany()) });
    await h.refresh("manual");
    expect(h.cache()?.retryUntil).toBe(T0 + 40 * MIN);
  });
  it("says a non-429 failure failed", () => {
    expect(heldText({ status: 503 }, T0 - 3 * MIN, T0)).toBe("Last refresh failed, showing numbers from 3m ago");
    expect(heldText(undefined, T0, T0)).toBeUndefined();
  });
});

describe("focus and panel open", () => {
  it("refresh only when the shared numbers are at least five minutes old", async () => {
    const h = harness({ cache: { fetchedAt: T0 - 4 * MIN, snapshot: snap(T0 - 4 * MIN), attemptedAt: T0 - 4 * MIN } });
    await h.refresh("focus");
    expect(h.fetches()).toBe(0);
    expect(h.engine.state.snapshot?.fetchedAt).toBe(T0 - 4 * MIN);
    h.advance(MIN);
    await h.refresh("focus");
    expect(h.fetches()).toBe(1);
    // The background timer waits the full interval.
    h.advance(10 * MIN);
    await h.refresh("auto");
    expect(h.fetches()).toBe(1);
    h.advance(5 * MIN);
    await h.refresh("auto");
    expect(h.fetches()).toBe(2);
  });

  it("decides from the shared cache file", () => {
    const fresh: UsageCacheFile = { fetchedAt: T0 - 2 * MIN, attemptedAt: T0 - 2 * MIN };
    expect(cacheDecision({ cache: fresh, now: T0, minAgeMs: FOCUS_STALE_MS })).toEqual({ action: "fresh", until: T0 + 3 * MIN });
    expect(cacheDecision({ cache: fresh, now: T0 + 3 * MIN, minAgeMs: FOCUS_STALE_MS })).toEqual({ action: "fetch" });
    expect(cacheDecision({ cache: fresh, now: T0, minAgeMs: 0 })).toEqual({ action: "fetch" });
    expect(cacheDecision({ cache: undefined, now: T0, minAgeMs: INTERVAL, localAttemptedAt: T0 - MIN })).toEqual({ action: "fresh", until: T0 - MIN + INTERVAL });
    expect(cacheDecision({ cache: { retryUntil: T0 + MIN }, now: T0, minAgeMs: 0 })).toEqual({ action: "retry-after", until: T0 + MIN });
    expect(cacheDecision({ cache: { retryUntil: T0 + MIN }, now: T0, minAgeMs: 0, ignoreRetryAfter: true })).toEqual({ action: "fetch" });
    // Once a window has reset, the background poll waits no longer than the focus gate.
    const reset: UsageCacheFile = { fetchedAt: T0 - 6 * MIN, attemptedAt: T0 - 6 * MIN, snapshot: { ...snap(T0 - 6 * MIN), fiveHour: { pct: 99, resetsAt: T0 - MIN } } };
    expect(cacheDecision({ cache: reset, now: T0, minAgeMs: INTERVAL })).toEqual({ action: "fetch" });
  });
});

describe("stale numbers", () => {
  it("drops a reading over an hour old or whose window has reset", () => {
    expect(readingExpired(T0 - 59 * MIN, [], T0)).toBe(false);
    expect(readingExpired(T0 - 61 * MIN, [], T0)).toBe(true);
    expect(readingExpired(T0 - MIN, [{ resetsAt: T0 + MIN }], T0)).toBe(false);
    expect(readingExpired(T0 - MIN, [{ resetsAt: T0 }], T0)).toBe(true);
    expect(usableSnapshot(snap(T0 - 61 * MIN), T0)).toBeUndefined();
    const reset = { ...snap(T0 - 2 * MIN), weekly: { pct: 50, resetsAt: T0 - 1 } };
    expect(usableSnapshot(reset, T0)).toBeUndefined();
    expect(toUsageView({ refreshing: false, snapshot: reset }, undefined, T0)).toEqual({ limits: [], refreshing: false });
    const m = statusModel({ refreshing: false, snapshot: snap(T0 - 61 * MIN) }, settings, T0);
    expect(m.text).toBe("$(sparkle) usage …");
    expect(m.lines[0]).toBe("Usage numbers are out of date, fetching new ones…");
  });

  it("spins the status bar icon while refreshing", () => {
    expect(statusModel({ refreshing: true, snapshot: snap(T0) }, settings, T0).text).toBe(`${REFRESHING_ICON} 5h 81% · wk 50%`);
    expect(statusModel({ refreshing: true }, settings, T0).text).toBe(`${REFRESHING_ICON} usage …`);
  });

  it("names the signed-in account in the tooltip and the view", () => {
    const state = { refreshing: false, snapshot: snap(T0), account: { email: "ai@example.com", organization: "Example" } };
    expect(statusModel(state, settings, T0).lines).toContain("Account: ai@example.com · Example");
    expect(toUsageView(state, undefined, T0).account).toEqual({ email: "ai@example.com", organization: "Example" });
  });

  it("explains the pace marker with the elapsed share of the window", () => {
    expect(paceMarkerText(0.42)).toBe(
      "Pace marker: 42% of this window has passed. Usage left of the line means you're on track to last until the reset; past it means you'll run out early.",
    );
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
    expect(fs.readFileSync(file, "utf8")).not.toContain("tok");
    const updated = await updateUsageCache((c) => ({ ...c, plan: "pro" }), file);
    expect(updated.fetchedAt).toBe(T0);
    // An account switch's epoch survives a writer that does not carry it.
    await updateUsageCache((c) => ({ ...c, credentialsEpoch: 5 }), file);
    expect((await updateUsageCache(() => ({ fetchedAt: 1 }), file)).credentialsEpoch).toBe(5);
  });

  it("waits for the fetch lock to be released, gives up at the deadline, and stops when cancelled", async () => {
    let holder: string | undefined = "a";
    setTimeout(() => (holder = undefined), 30);
    expect(await waitForLockRelease("a", Date.now() + 2_000, () => holder, { pollMs: 5 })).toBe(true);
    const start = Date.now();
    expect(await waitForLockRelease("b", start + 50, () => "b", { pollMs: 5 })).toBe(false);
    expect(Date.now() - start).toBeLessThan(1_000);
    expect(await waitForLockRelease("b", Date.now() + 5_000, () => "b", { pollMs: 5, cancelled: () => true })).toBe(false);
  });

  it("creates the fetch lock exclusively on disk, clears a dead holder's and deletes only its own", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-lock-"));
    try {
      const file = path.join(dir, "fetch.lock");
      const a = new FetchLock(fileLockDeps(file));
      const first = a.tryAcquire()!;
      expect(first).toBeDefined();
      expect(a.tryAcquire()).toBeUndefined();
      if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      // A lock left by a process that is gone is cleared and taken.
      fs.writeFileSync(file, JSON.stringify({ id: "dead", pid: 2 ** 22 + 12345, at: Date.now() }));
      const taken = a.tryAcquire()!;
      expect(taken).toBeDefined();
      a.release(first);
      expect(fs.existsSync(file)).toBe(true);
      a.release(taken);
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
describe("environment guard", () => {
  it("disables polling when CC_HISTORY_DISABLE_USAGE is set to anything but 0 or false", () => {
    expect(usageDisabledByEnv({})).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "0" })).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "false" })).toBe(false);
    expect(usageDisabledByEnv({ CC_HISTORY_DISABLE_USAGE: "1" })).toBe(true);
  });
});

/** Lease deps over an in-memory file shared by several fake windows. */
function leaseWorld(alive: Set<number>) {
  let file: string | undefined;
  let now = T0;
  const window = (pid: number): LeaseDeps => ({
    read: () => file,
    write: (d) => (file = d),
    remove: () => (file = undefined),
    now: () => now,
    pidAlive: (p) => alive.has(p),
    pid,
  });
  return { window, file: () => file, setFile: (f: string | undefined) => (file = f), advance: (ms: number) => (now += ms) };
}

describe("leader lease", () => {
  it("is taken when no window holds it, and renewed by its holder", () => {
    const w = leaseWorld(new Set([1, 2]));
    const a = new LeaderLease(w.window(1));
    expect(a.tick()).toBe(true);
    expect(parseLease(w.file())).toEqual({ pid: 1, heartbeatAt: T0 });
    w.advance(MIN);
    expect(a.tick()).toBe(true);
    expect(parseLease(w.file())?.heartbeatAt).toBe(T0 + MIN);
  });

  it("is respected while its holder is alive and renewing", () => {
    const w = leaseWorld(new Set([1, 2]));
    const a = new LeaderLease(w.window(1));
    const b = new LeaderLease(w.window(2));
    a.tick();
    expect(b.tick()).toBe(false);
    expect(b.isLeader).toBe(false);
    expect(parseLease(w.file())?.pid).toBe(1);
  });

  it("is taken over from a dead process", () => {
    const alive = new Set([1, 2]);
    const w = leaseWorld(alive);
    new LeaderLease(w.window(1)).tick();
    alive.delete(1);
    expect(new LeaderLease(w.window(2)).tick()).toBe(true);
    expect(parseLease(w.file())?.pid).toBe(2);
  });

  it("is taken over when the heartbeat is stale even if the pid is in use", () => {
    const w = leaseWorld(new Set([1, 2]));
    new LeaderLease(w.window(1)).tick();
    const b = new LeaderLease(w.window(2));
    w.advance(4 * MIN);
    expect(b.tick()).toBe(false);
    w.advance(MIN);
    expect(b.tick()).toBe(true);
  });

  it("follows when another window wins the write race", () => {
    const w = leaseWorld(new Set([1, 2]));
    const deps = w.window(2);
    // Window 1 writes between our write and our read-back.
    const racing: LeaseDeps = { ...deps, write: (d) => (deps.write(d), w.setFile(JSON.stringify({ pid: 1, heartbeatAt: T0 }))) };
    expect(new LeaderLease(racing).tick()).toBe(false);
  });

  it("is released only by its holder", () => {
    const w = leaseWorld(new Set([1, 2]));
    const a = new LeaderLease(w.window(1));
    const b = new LeaderLease(w.window(2));
    a.tick();
    b.release();
    expect(parseLease(w.file())?.pid).toBe(1);
    a.release();
    expect(w.file()).toBeUndefined();
    expect(a.isLeader).toBe(false);
  });

  it("writes the lease file atomically on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-lease-"));
    try {
      const file = path.join(dir, "leader.json");
      const lease = new LeaderLease(fileLeaseDeps(file));
      expect(lease.tick()).toBe(true);
      expect(parseLease(fs.readFileSync(file, "utf8"))?.pid).toBe(process.pid);
      expect(fs.readdirSync(dir)).toEqual(["leader.json"]);
      lease.release();
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("background poll timer", () => {
  it("runs only in the leader, comes back after a reset, and never inside Retry-After", () => {
    const state = { refreshing: false, snapshot: { ...snap(T0), fiveHour: { pct: 10, resetsAt: T0 + 3 * MIN } } };
    expect(nextPollDelay(state, INTERVAL, false, T0)).toBeUndefined();
    expect(nextPollDelay({ refreshing: false }, INTERVAL, true, T0)).toBe(INTERVAL);
    expect(nextPollDelay(state, INTERVAL, true, T0)).toBe(3 * MIN + 10_000);
    expect(nextPollDelay({ ...state, retryUntil: T0 + 40 * MIN }, INTERVAL, true, T0)).toBe(40 * MIN);
  });
});

describe("fetch lock", () => {
  it("is exclusive; a stale one (dead holder or 30s old) is taken over", () => {
    const w = newWorld();
    const a = new FetchLock(lockDeps(w, 4242));
    const b = new FetchLock(lockDeps(w, 99));
    const held = a.tryAcquire()!;
    expect(b.tryAcquire()).toBeUndefined();
    expect(b.holder()?.id).toBe(held.id);
    w.now += LOCK_MAX_AGE_MS;
    expect(b.holder()).toBeUndefined();
    expect(b.tryAcquire()).toBeDefined();
    w.alive.delete(99);
    expect(a.tryAcquire()).toBeDefined();
  });

  it("lets two windows focusing together make one call", async () => {
    const g = gate();
    const w = newWorld({ fetchedAt: T0 - 10 * MIN, snapshot: snap(T0 - 10 * MIN), attemptedAt: T0 - 10 * MIN });
    const a = harness({ fetch: () => g.opened.then(() => snap(w.now)) }, w);
    const b = harness({ pid: 99 }, w);
    const pa = a.refresh("focus");
    await tick();
    await b.refresh("focus");
    g.open();
    await pa;
    expect(a.fetches() + b.fetches()).toBe(1);
    // The second window now finds the fresh result.
    await b.refresh("focus");
    expect(b.fetches()).toBe(0);
    expect(b.engine.state.snapshot?.fetchedAt).toBe(T0);
  });
});

describe("account switch", () => {
  it("makes every window drop the old token and the old numbers", async () => {
    const w = newWorld();
    const leader = harness({ pid: 99 }, w);
    await leader.refresh("auto");
    expect(leader.tokens).toEqual(["old"]);
    leader.engine.state = { ...leader.engine.state, account: { email: "old@example.com" } };
    const switcher = harness({}, w);
    w.token = "new";
    await switcher.refresher.switchAccount();
    expect(w.cache).toEqual({ credentialsEpoch: T0 });
    // The leader's next poll sees the epoch, re-reads the token and forgets the old account.
    w.now += INTERVAL;
    await leader.refresh("auto");
    expect(leader.tokens).toEqual(["old", "new"]);
    expect(leader.engine.state.account).toBeUndefined();
  });

  it("discards a result fetched with the old token while the switch happened", async () => {
    const g = gate();
    const w = newWorld();
    const leader = harness({ pid: 99, fetch: () => g.opened.then(() => snap(w.now, 11)) }, w);
    const inFlight = leader.refresh("auto");
    await tick();
    const switcher = harness({}, w);
    await switcher.refresher.switchAccount();
    g.open();
    await inFlight;
    expect(w.cache?.snapshot).toBeUndefined();
    expect(leader.engine.state.snapshot).toBeUndefined();
    expect(leader.log.some((l) => l.includes("result discarded"))).toBe(true);
  });

  it("never takes another window's in-flight result after a switch: waits for the lock, then fetches itself", async () => {
    const g = gate();
    const w = newWorld();
    const leader = harness({ pid: 99, fetch: () => g.opened.then(() => snap(w.now, 11)) }, w);
    const leaderRun = leader.refresh("auto");
    await tick();
    const switcher = harness({ fetch: () => snap(w.now, 22) }, w);
    switcher.onOtherWindow(async () => {
      g.open();
      await leaderRun;
      return true;
    });
    w.token = "new";
    await switcher.refresher.switchAccount();
    await switcher.refresh("manual");
    expect(switcher.waits).toHaveLength(1);
    expect(switcher.fetches()).toBe(1);
    expect(switcher.tokens).toEqual(["new"]);
    expect(w.cache?.snapshot?.fiveHour?.pct).toBe(22);
    expect(switcher.engine.state.snapshot?.fiveHour?.pct).toBe(22);
  });

  it("takes plan and account from the cache as written", () => {
    const h = harness();
    h.engine.state = { refreshing: false, snapshot: snap(T0 - MIN), account: { email: "old@example.com" }, plan: "max" };
    h.engine.adopt({ fetchedAt: T0, snapshot: snap(T0) });
    expect(h.engine.state.account).toBeUndefined();
    expect(h.engine.state.plan).toBeUndefined();
  });
});

describe("account change detection", () => {
  const claudeJson = (uuid?: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ numStartups: 3, ...(uuid ? { oauthAccount: { accountUuid: uuid, emailAddress: "a@example.com", ...extra } } : {}) });

  /** A watcher over a fake ~/.claude.json; `file` is what the next read returns. */
  function watcher(onSwitch: (at: number) => void = () => {}) {
    const state: { file: ClaudeJsonRead | undefined; switches: number[]; log: string[] } = { file: undefined, switches: [], log: [] };
    const w = new AccountWatcher({
      read: async () => state.file,
      onSwitch: (at) => {
        state.switches.push(at);
        onSwitch(at);
      },
      now: () => T0,
      log: (l) => state.log.push(l),
    });
    return { w, state };
  }

  it("reads only the account id", () => {
    expect(parseAccountUuid(claudeJson("u-1"))).toBe("u-1");
    expect(parseAccountUuid(claudeJson())).toBeUndefined();
    expect(parseAccountUuid("not json")).toBeUndefined();
    expect(parseAccountUuid(JSON.stringify({ oauthAccount: { accountUuid: 7 } }))).toBeUndefined();
  });

  it("does not report the account signed in at startup", async () => {
    const { w, state } = watcher();
    state.file = { raw: claudeJson("u-1"), mtimeMs: T0 };
    await w.init();
    expect(await w.check()).toBe(false);
    expect(state.switches).toEqual([]);
  });

  it("reports a changed account id once, with the file's write time", async () => {
    const { w, state } = watcher();
    state.file = { raw: claudeJson("u-1"), mtimeMs: T0 };
    await w.init();
    state.file = { raw: claudeJson("u-2"), mtimeMs: T0 + 5_000.7 };
    const [a, b] = await Promise.all([w.check(), w.check()]);
    expect([a, b]).toEqual([true, false]);
    expect(await w.check()).toBe(false);
    expect(state.switches).toEqual([T0 + 5_000]);
    expect(state.log).toEqual([`${new Date(T0).toISOString()} account change detected (~/.claude.json)`]);
  });

  it("ignores an unchanged id, a missing file and a file without an account", async () => {
    const { w, state } = watcher();
    state.file = { raw: claudeJson("u-1"), mtimeMs: T0 };
    await w.init();
    state.file = { raw: claudeJson("u-1", { organizationName: "Other" }), mtimeMs: T0 + 1 };
    expect(await w.check()).toBe(false);
    state.file = undefined;
    expect(await w.check()).toBe(false);
    state.file = { raw: claudeJson(), mtimeMs: T0 + 2 };
    expect(await w.check()).toBe(false);
    state.file = { raw: "{ half writ", mtimeMs: T0 + 3 };
    expect(await w.check()).toBe(false);
    // Signing back in to the same account after a sign-out is no switch either.
    state.file = { raw: claudeJson("u-1"), mtimeMs: T0 + 4 };
    expect(await w.check()).toBe(false);
    expect(state.switches).toEqual([]);
  });

  it("switches the account and fetches with the new token when the id changes", async () => {
    const w = newWorld();
    const h = harness({}, w);
    await h.refresh("auto");
    let run: Promise<boolean> | undefined;
    const { w: acct, state } = watcher((at) => (run = h.refresher.accountChanged(at)));
    state.file = { raw: claudeJson("u-1"), mtimeMs: T0 };
    await acct.init();
    w.token = "new";
    h.advance(MIN);
    state.file = { raw: claudeJson("u-2"), mtimeMs: w.now };
    await acct.check();
    expect(await run).toBe(true);
    expect(h.tokens).toEqual(["old", "new"]);
    expect(w.cache?.credentialsEpoch).toBe(w.now);
  });

  it("lets two windows noticing the same change make one fetch", async () => {
    const w = newWorld({ fetchedAt: T0 - MIN, attemptedAt: T0 - MIN, snapshot: snap(T0 - MIN, 100) });
    const a = harness({ pid: 99, fetch: async () => (await tick(), snap(w.now, 11)) }, w);
    const b = harness({ pid: 77, fetch: async () => (await tick(), snap(w.now, 11)) }, w);
    const lockFree = async () => {
      while (w.lockFile !== undefined) await tick();
      return true;
    };
    a.onOtherWindow(lockFree);
    b.onOtherWindow(lockFree);
    w.token = "new";
    const at = T0 - 500;
    // Both at once.
    const [ra, rb] = await Promise.all([a.refresher.accountChanged(at), b.refresher.accountChanged(at)]);
    expect(ra || rb).toBe(true);
    expect(a.fetches() + b.fetches()).toBe(1);
    expect(w.cache?.snapshot?.fiveHour?.pct).toBe(11);
    expect(a.engine.state.snapshot?.fiveHour?.pct).toBe(11);
    expect(b.engine.state.snapshot?.fiveHour?.pct).toBe(11);
    // A third window noticing it later, after the result is in, takes that result.
    const c = harness({ pid: 4242 }, w);
    expect(await c.refresher.accountChanged(at)).toBe(false);
    expect(c.fetches()).toBe(0);
    expect(c.engine.state.snapshot?.fiveHour?.pct).toBe(11);
    // And the window that applied it already ignores its own watcher's late report.
    expect(await a.refresher.accountChanged(at)).toBe(false);
    expect(a.fetches() + b.fetches()).toBe(1);
  });

  it("when both read usage.json before either wrote the switch, still one fetch", async () => {
    for (const together of [true, false]) {
      const before: UsageCacheFile = { fetchedAt: T0 - MIN, attemptedAt: T0 - MIN, snapshot: snap(T0 - MIN, 100) };
      const w = newWorld(structuredClone(before));
      const a = harness({ pid: 99, fetch: async () => (await tick(), snap(w.now, 11)) }, w);
      const b = harness({ pid: 77, fetch: async () => (await tick(), snap(w.now, 11)) }, w);
      a.onOtherWindow(async () => {
        while (w.lockFile !== undefined) await tick();
        return true;
      });
      b.onOtherWindow(async () => {
        while (w.lockFile !== undefined) await tick();
        return true;
      });
      w.token = "new";
      expect(await a.refresher.switchAccount(T0 - 500)).toBe(true);
      const afterA = structuredClone(w.cache);
      // B read the file before A's write landed: it applies the same epoch and writes the same thing.
      w.cache = structuredClone(before);
      expect(await b.refresher.switchAccount(T0 - 500)).toBe(true);
      expect(w.cache).toEqual(afterA);
      if (together) await Promise.all([a.refresh("manual"), b.refresh("manual")]);
      else {
        await a.refresh("manual");
        await b.refresh("manual");
      }
      expect(a.fetches() + b.fetches()).toBe(1);
      expect(a.engine.state.snapshot?.fiveHour?.pct).toBe(11);
      expect(b.engine.state.snapshot?.fiveHour?.pct).toBe(11);
    }
  });

  it("one window after the other: the second neither bumps nor fetches", async () => {
    const w = newWorld();
    const a = harness({ pid: 99 }, w);
    const b = harness({ pid: 77 }, w);
    w.token = "new";
    expect(await a.refresher.accountChanged(T0)).toBe(true);
    const after = structuredClone(w.cache);
    w.now += 2_000;
    expect(await b.refresher.accountChanged(T0)).toBe(false);
    expect(w.cache).toEqual(after);
    expect(a.fetches() + b.fetches()).toBe(1);
  });

  it("on a manual refresh, a new token for another account is an account switch: fetch with it", async () => {
    const w = newWorld();
    w.claudeJson = { raw: claudeJson("u-1"), mtimeMs: T0 - MIN };
    const h = harness({}, w);
    await h.account.init();
    await h.refresh("auto");
    w.token = "new";
    h.advance(MIN);
    w.claudeJson = { raw: claudeJson("u-2"), mtimeMs: w.now - 1_000 };
    await h.manual();
    expect(h.tokens).toEqual(["old", "new"]);
    expect(h.fetches()).toBe(2);
    expect(w.cache?.credentialsEpoch).toBe(w.now - 1_000);
    expect(h.log.some((l) => l.endsWith("account change detected (new token on refresh)"))).toBe(true);
  });

  it("a renewed token for the same account is no switch: no epoch, and a rate limit still holds", async () => {
    const w = newWorld();
    w.claudeJson = { raw: claudeJson("u-1"), mtimeMs: T0 - MIN };
    const h = harness({ fetch: () => tooMany(40 * MIN) }, w);
    await h.account.init();
    await h.refresh("manual");
    expect(h.engine.state.retryUntil).toBe(T0 + 40 * MIN);
    const before = structuredClone(w.cache);
    w.token = "renewed";
    h.advance(MIN);
    await h.manual();
    expect(h.fetches()).toBe(1);
    expect(w.cache).toEqual(before);
    expect(w.cache?.credentialsEpoch).toBeUndefined();
    expect(h.log.some((l) => l.includes("account change detected"))).toBe(false);
    expect(h.log.some((l) => l.includes("manual refresh refused"))).toBe(true);
    // Once the hold is over, the renewed token is the one used.
    h.advance(40 * MIN);
    await h.manual();
    expect(h.tokens).toEqual(["old", "renewed"]);
  });

  it("on a manual refresh, the same token is no switch", async () => {
    const w = newWorld();
    const h = harness({}, w);
    await h.refresh("auto");
    h.advance(MIN);
    await h.manual();
    expect(h.tokens).toEqual(["old", "old"]);
    expect(w.cache?.credentialsEpoch).toBeUndefined();
    expect(h.log.some((l) => l.includes("account change detected"))).toBe(false);
  });

  it("background refreshes never read past the token cache", async () => {
    let reads = 0;
    const cache = new CredentialsCache(async () => (reads++, valid(T0)));
    await cache.get(T0);
    await cache.get(T0 + MIN);
    expect(reads).toBe(1);
    expect(await cache.tokenChanged()).toBe(false);
    expect(reads).toBe(2);
    expect(tokenDigest("a")).not.toBe(tokenDigest("b"));
    expect(tokenDigest("a")).toHaveLength(64);
  });

  it("watches ~/.claude.json across atomic rename writes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-acct-"));
    const file = path.join(dir, ".claude.json");
    fs.writeFileSync(file, claudeJson("u-1"));
    let calls = 0;
    const stop = watchClaudeJson(() => calls++, file, { debounceMs: 20, intervalMs: 25 });
    try {
      await new Promise((r) => setTimeout(r, 60));
      const tmp = path.join(dir, ".claude.json.tmp");
      fs.writeFileSync(tmp, claudeJson("u-2"));
      fs.renameSync(tmp, file);
      for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(calls).toBe(1);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
