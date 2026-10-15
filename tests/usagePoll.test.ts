import { describe, expect, it } from "vitest";
import { CredentialsCache, pickLaterCredentials, readCredentials, type Credentials } from "../src/extension/usage/credentials";
import { DEFAULT_DISPLAY_SETTINGS, STALE_MARKER, TOKEN_HINT, statusModel } from "../src/extension/usage/format";
import { PollEngine, type UsageState } from "../src/extension/usage/pollEngine";
import { CREDENTIAL_RETRY_MS, MAX_BACKOFF_MS } from "../src/extension/usage/schedule";
import { UsageError, type UsageSnapshot } from "../src/extension/usage/usageClient";

const T0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const MIN = 60_000;
const INTERVAL = 60_000;
const settings = { ...DEFAULT_DISPLAY_SETTINGS, intervalMs: INTERVAL };

function snap(fetchedAt: number, pct = 81): UsageSnapshot {
  return { fetchedAt, fiveHour: { pct }, weekly: { pct: 50 }, scoped: [] };
}

/** A poll engine over a fake clock, a scripted credentials reader and a scripted fetch. */
function harness(opts: {
  creds: (fresh: boolean) => Credentials | undefined;
  fetch: () => UsageSnapshot | Error;
}) {
  let now = T0;
  const log: string[] = [];
  let freshReads = 0;
  let cachedReads = 0;
  const cache = new CredentialsCache(async () => opts.creds(true));
  const engine = new PollEngine({
    readCredentials: (at, o) => {
      if (o.fresh) freshReads++;
      else cachedReads++;
      return cache.get(at, o);
    },
    invalidateCredentials: () => cache.invalidate(),
    fetchUsage: async () => {
      const r = opts.fetch();
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => now,
    log: (line) => log.push(line),
  });
  return {
    engine,
    log,
    advance: (ms: number) => (now += ms),
    now: () => now,
    reads: () => ({ fresh: freshReads, cached: cachedReads }),
  };
}

const valid = (now: number): Credentials => ({ accessToken: "tok", expiresAt: now + 8 * 3_600_000, source: "keychain" });

describe("poll engine", () => {
  it("keeps the last good reading through failures and marks it stale after two intervals", async () => {
    let fetchOk = true;
    const h = harness({ creds: () => valid(h.now()), fetch: () => (fetchOk ? snap(h.now()) : new UsageError("network", "ECONNRESET")) });
    await h.engine.pollOnce(INTERVAL);
    const good = statusModel(h.engine.state, settings, h.now());
    expect(good.text).toBe("$(sparkle) 5h 81% · wk 50%");
    expect(good.stale).toBe(false);
    expect(good.lines[0]).toBe("5-hour window: 81% used");

    fetchOk = false;
    h.advance(INTERVAL);
    const { state } = await h.engine.pollOnce(INTERVAL);
    expect(state.snapshot?.fetchedAt).toBe(T0);
    expect(state.error).toMatchObject({ reason: "network", since: T0 + INTERVAL });
    // One interval old: values shown, not yet stale.
    const soon = statusModel(state, settings, h.now());
    expect(soon.text).toBe("$(sparkle) 5h 81% · wk 50%");
    expect(soon.lines.slice(0, 2)).toEqual(["Stale: last update 1m ago", "Network error"]);
    // Past two intervals the marker appears; the tooltip still leads with the failure.
    h.advance(12 * MIN);
    const old = statusModel(state, settings, h.now());
    expect(old.text).toBe(`$(sparkle) 5h 81% · wk 50%${STALE_MARKER}`);
    expect(old.stale).toBe(true);
    expect(old.lines[0]).toBe("Stale: last update 13m ago");
    expect(old.level).toBe("warning");
  });

  it("shows 'usage ?' only before any snapshot has arrived", async () => {
    const h = harness({ creds: () => valid(h.now()), fetch: () => new UsageError("network", "down") });
    const empty: UsageState = { refreshing: true };
    expect(statusModel(empty, settings, h.now()).text).toBe("$(sparkle) usage …");
    const { state } = await h.engine.pollOnce(INTERVAL);
    const failed = statusModel(state, settings, h.now());
    expect(failed.text).toBe("$(sparkle) usage ?");
    expect(failed.lines[0]).toBe("Claude Code usage unavailable: Network error");
  });

  it("retries credential failures every 30s without backoff and skips the network while the token is expired", async () => {
    let tokenExpiry = T0 - 1;
    let fetches = 0;
    const h = harness({
      creds: () => ({ accessToken: "old", expiresAt: tokenExpiry, source: "keychain" }),
      fetch: () => (fetches++, snap(h.now())),
    });
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const out = await h.engine.pollOnce(INTERVAL);
      delays.push(out.delayMs);
      expect(out.state.error?.reason).toBe("token-expired");
      h.advance(out.delayMs);
    }
    expect(delays).toEqual([CREDENTIAL_RETRY_MS, CREDENTIAL_RETRY_MS, CREDENTIAL_RETRY_MS, CREDENTIAL_RETRY_MS]);
    expect(fetches).toBe(0);
    // Every attempt re-read the credentials fresh, bypassing the cache.
    expect(h.reads().fresh).toBe(4);
    expect(h.engine.state.error?.since).toBe(T0);
    // A rejected token (401) is a credential failure too.
    const rejected = harness({ creds: () => valid(rejected.now()), fetch: () => new UsageError("http", "HTTP 401.", 401) });
    expect((await rejected.engine.pollOnce(INTERVAL)).delayMs).toBe(CREDENTIAL_RETRY_MS);
    expect((await rejected.engine.pollOnce(INTERVAL)).delayMs).toBe(CREDENTIAL_RETRY_MS);
    // Then Claude Code rotates the token: the next poll picks it up and succeeds.
    tokenExpiry = h.now() + 8 * 3_600_000;
    const ok = await h.engine.pollOnce(INTERVAL);
    expect(ok.state.error).toBeUndefined();
    expect(ok.state.snapshot?.fetchedAt).toBe(h.now());
    expect(ok.delayMs).toBe(INTERVAL);
  });

  it("re-reads credentials immediately when the cached token has expired", async () => {
    let rotated = false;
    const h = harness({
      creds: () => (rotated ? valid(h.now()) : { accessToken: "old", expiresAt: T0 + 30_000, source: "keychain" }),
      fetch: () => snap(h.now()),
    });
    expect((await h.engine.pollOnce(INTERVAL)).state.snapshot).toBeDefined();
    // The token expires and Claude Code rotates the Keychain entry seconds later.
    h.advance(INTERVAL);
    rotated = true;
    const out = await h.engine.pollOnce(INTERVAL);
    expect(out.state.error).toBeUndefined();
    expect(out.state.snapshot?.fetchedAt).toBe(T0 + INTERVAL);
    expect(h.log.some((l) => l.includes("credentials from keychain, expires 2026-10-15T20:01:00.000Z"))).toBe(true);
    expect(h.log.join("\n")).not.toContain("tok");
  });

  it("backs off network and server failures up to five minutes", async () => {
    const h = harness({ creds: () => valid(h.now()), fetch: () => new UsageError("http", "HTTP 503.", 503) });
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) delays.push((await h.engine.pollOnce(INTERVAL)).delayMs);
    expect(delays).toEqual([120_000, 240_000, MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
    expect(h.engine.state.error).toMatchObject({ reason: "http", status: 503 });
    expect(h.log[h.log.length - 1]).toMatch(/poll failed: http \(http 503\), next in 300s$/);
  });

  it("asks for Claude Code once the token has been expired for ten minutes", async () => {
    const h = harness({ creds: () => ({ accessToken: "old", expiresAt: T0 - 1 }), fetch: () => snap(h.now()) });
    const { state } = await h.engine.pollOnce(INTERVAL);
    expect(statusModel(state, settings, h.now()).lines).not.toContain(TOKEN_HINT);
    h.advance(11 * MIN);
    const lines = statusModel(state, settings, h.now()).lines;
    expect(lines).toContain(TOKEN_HINT);
    expect(lines[0]).toBe("Claude Code usage unavailable: Claude Code login token expired, waiting for Claude Code to refresh it");
  });
});

describe("credential sources", () => {
  const entry = (token: string, expiresAt?: number) =>
    JSON.stringify({ claudeAiOauth: { accessToken: token, ...(expiresAt !== undefined ? { expiresAt } : {}) } });

  it("picks whichever of the Keychain and the file expires later on macOS", async () => {
    const later = await readCredentials("darwin", {
      keychain: async () => entry("kc", T0 + MIN),
      file: async () => entry("file", T0 + 8 * 3_600_000),
    });
    expect(later).toMatchObject({ accessToken: "file", source: "file" });
    const keychainWins = await readCredentials("darwin", {
      keychain: async () => entry("kc", T0 + 9 * 3_600_000),
      file: async () => entry("file", T0 + 8 * 3_600_000),
    });
    expect(keychainWins).toMatchObject({ accessToken: "kc", source: "keychain" });
    // A missing or unreadable source leaves the other.
    expect(await readCredentials("darwin", { keychain: async () => undefined, file: async () => entry("file", T0) })).toMatchObject({
      accessToken: "file",
    });
    expect(await readCredentials("darwin", { keychain: async () => entry("kc", T0), file: async () => "not json" })).toMatchObject({
      accessToken: "kc",
    });
    // Elsewhere only the file counts.
    expect(await readCredentials("linux", { keychain: async () => entry("kc", T0 + MIN), file: async () => entry("file", T0) })).toMatchObject({
      accessToken: "file",
    });
  });

  it("lets an entry with an expiry beat one without", () => {
    expect(pickLaterCredentials({ accessToken: "a" }, { accessToken: "b", expiresAt: 1 })?.accessToken).toBe("b");
    expect(pickLaterCredentials({ accessToken: "a", expiresAt: 5 }, { accessToken: "b", expiresAt: 1 })?.accessToken).toBe("a");
    expect(pickLaterCredentials(undefined, undefined)).toBeUndefined();
  });
});
