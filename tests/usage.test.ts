import { describe, expect, it } from "vitest";
import { CredentialsCache, parseCredentials, type Credentials } from "../src/extension/usage/credentials";
import {
  formatAgo,
  formatResetAt,
  relativeDuration,
  severity,
  statusBarText,
  tooltipLines,
} from "../src/extension/usage/format";
import { intervalMs, MAX_BACKOFF_MS, nextDelayMs } from "../src/extension/usage/schedule";
import { fetchUsage, parseUsage, UsageError, USAGE_URL } from "../src/extension/usage/usageClient";

const sample = {
  five_hour: { utilization: 81.0, resets_at: "2026-10-15T11:59:59.850365+00:00", extra: 1 },
  seven_day: { utilization: 33.0, resets_at: "2026-10-21T09:59:59.850387+00:00" },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, utilization: null },
  limits: [{ kind: "session", group: "session", percent: 81, severity: "warning", scope: null, is_active: true }],
  weekly_scoped_shares: [{ limit_index: 2, used_percent_of_weekly: 32, allowance_percent_of_weekly: 50 }],
  something_new: { ignored: true },
};
const fetchedAt = Date.parse("2026-10-15T11:05:00.000Z");

describe("usage parsing", () => {
  it("reads the five-hour, weekly and scoped share values from the sample response", () => {
    const snap = parseUsage(sample, fetchedAt);
    expect(snap.fetchedAt).toBe(fetchedAt);
    expect(snap.fiveHour).toEqual({ pct: 81, resetsAt: Date.parse("2026-10-15T11:59:59.850365+00:00") });
    expect(snap.weekly).toEqual({ pct: 33, resetsAt: Date.parse("2026-10-21T09:59:59.850387+00:00") });
    expect(snap.scoped).toEqual([{ label: "Fable", pct: 64, resetsAt: snap.weekly?.resetsAt }]);
  });

  it("tolerates nulls, missing blocks and an empty share list", () => {
    const snap = parseUsage(
      { five_hour: null, seven_day: { utilization: "33" }, weekly_scoped_shares: [], extra_usage: null },
      fetchedAt,
    );
    expect(snap.fiveHour).toBeUndefined();
    expect(snap.weekly).toBeUndefined();
    expect(snap.scoped).toEqual([]);
    expect(parseUsage({}, fetchedAt).scoped).toEqual([]);
    expect(parseUsage({ weekly_scoped_shares: null }, fetchedAt).scoped).toEqual([]);
    expect(parseUsage({ weekly_scoped_shares: [{ used_percent_of_weekly: 5, allowance_percent_of_weekly: 0 }] }, fetchedAt).scoped).toEqual([]);
  });

  it("surfaces per-model weekly limits and extra usage only when enabled", () => {
    const snap = parseUsage(
      {
        ...sample,
        seven_day_opus: { utilization: 12, resets_at: "2026-10-21T09:59:59Z" },
        seven_day_sonnet: { utilization: 7 },
        extra_usage: { is_enabled: true, utilization: 3.5 },
      },
      fetchedAt,
    );
    expect(snap.scoped.map((s) => [s.label, s.pct])).toEqual([
      ["Fable", 64],
      ["Opus", 12],
      ["Sonnet", 7],
      ["Extra", 3.5],
    ]);
  });

  it("rejects responses that are not objects", () => {
    expect(() => parseUsage("nope", fetchedAt)).toThrow(UsageError);
    expect(() => parseUsage(null, fetchedAt)).toThrow(/JSON object/);
  });
});

describe("usage fetch", () => {
  const ok = (body: unknown): Response =>
    ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as unknown as Response;

  it("sends the bearer token and beta header to the usage endpoint only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return ok(sample);
    }) as unknown as typeof fetch;
    const snap = await fetchUsage("tok-123", { version: "0.1.0", fetchImpl, now: () => fetchedAt });
    expect(snap.fiveHour?.pct).toBe(81);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(USAGE_URL);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(headers["User-Agent"]).toBe("cc-history/0.1.0");
  });

  it("maps HTTP failures, network errors and bad JSON to typed reasons", async () => {
    const http = (async () => ({ ok: false, status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    await expect(fetchUsage("t", { version: "0", fetchImpl: http })).rejects.toMatchObject({ reason: "http" });
    const net = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(fetchUsage("t", { version: "0", fetchImpl: net })).rejects.toMatchObject({ reason: "network" });
    const bad = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("x");
      },
    })) as unknown as typeof fetch;
    await expect(fetchUsage("t", { version: "0", fetchImpl: bad })).rejects.toMatchObject({ reason: "parse" });
  });

  it("times out", async () => {
    const slow = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    await expect(fetchUsage("t", { version: "0", fetchImpl: slow, timeoutMs: 5 })).rejects.toMatchObject({
      reason: "network",
      message: "Request timed out.",
    });
  });
});

describe("credentials parsing", () => {
  it("extracts the claude.ai oauth block and ignores the rest", () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: "abc",
        refreshToken: "r",
        expiresAt: 1792077221156,
        scopes: ["user:inference"],
        subscriptionType: "team",
        rateLimitTier: "default_claude_max_5x",
      },
      mcpOAuth: {},
      organizationUuid: "org",
    });
    expect(parseCredentials(raw)).toEqual({
      accessToken: "abc",
      expiresAt: 1792077221156,
      subscriptionType: "team",
      rateLimitTier: "default_claude_max_5x",
    });
    expect(parseCredentials("{}")).toBeUndefined();
    expect(parseCredentials("not json")).toBeUndefined();
    expect(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: "" } }))).toBeUndefined();
  });
});

describe("poll schedule", () => {
  it("clamps the interval and backs off exponentially up to ten minutes", () => {
    expect(intervalMs(undefined)).toBe(60_000);
    expect(intervalMs(10)).toBe(30_000);
    expect(intervalMs(90.9)).toBe(90_000);
    expect(nextDelayMs(60_000, 0)).toBe(60_000);
    expect(nextDelayMs(60_000, 1)).toBe(120_000);
    expect(nextDelayMs(60_000, 2)).toBe(240_000);
    expect(nextDelayMs(60_000, 3)).toBe(480_000);
    expect(nextDelayMs(60_000, 4)).toBe(MAX_BACKOFF_MS);
    expect(nextDelayMs(60_000, 50)).toBe(MAX_BACKOFF_MS);
  });
});

describe("usage formatting", () => {
  const snap = parseUsage(sample, fetchedAt);

  it("builds the status bar text and omits missing segments", () => {
    expect(statusBarText(snap)).toBe("$(sparkle) 5h 81% · wk 33% · F 64%");
    expect(statusBarText({ fetchedAt, weekly: { pct: 33.4 }, scoped: [] })).toBe("$(sparkle) wk 33%");
    expect(statusBarText({ fetchedAt, scoped: [] })).toBe("$(sparkle) usage");
  });

  it("formats durations and reset times", () => {
    expect(relativeDuration(55 * 60_000)).toBe("55m");
    expect(relativeDuration(5 * 3_600_000 + 22 * 60_000)).toBe("5h 22m");
    expect(relativeDuration(5 * 86_400_000 + 22 * 3_600_000 + 5 * 60_000)).toBe("5d 22h");
    expect(relativeDuration(10_000)).toBe("<1m");
    expect(relativeDuration(-5)).toBe("now");
    expect(formatAgo(12_500)).toBe("12s ago");
    expect(formatAgo(3 * 60_000)).toBe("3m ago");
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const soon = formatResetAt(now + 55 * 60_000, now);
    expect(soon).toMatch(/^\d{2}:\d{2} \(in 55m\)$/);
    const later = formatResetAt(now + 5 * 86_400_000 + 22 * 3_600_000, now);
    expect(later).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2} \(in 5d 22h\)$/);
  });

  it("rounds a reset reported just short of the minute to that minute, in every surface", () => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const resetsAt = Date.parse("2026-10-15T22:59:59.850Z");
    const now = Date.parse("2026-10-15T22:05:00.000Z");
    const rounded = new Date(Date.parse("2026-10-15T23:00:00.000Z"));
    const clock = `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
    expect(formatResetAt(resetsAt, now)).toBe(`${clock} (in 55m)`);
    // The status bar tooltip reads the same clock as the panel.
    const snap = parseUsage({ five_hour: { utilization: 10, resets_at: "2026-10-15T22:59:59.850365+00:00" } }, now);
    expect(tooltipLines(snap, { now })[0]).toContain(`resets ${clock} (in 55m)`);
  });

  it("lists one tooltip line per limit plus freshness and plan", () => {
    const now = fetchedAt + 12_000;
    const lines = tooltipLines(snap, { now, plan: "team (default_claude_max_5x)" });
    // 11:59:59 rounds to 12:00, and 11:05:12 to 11:05, so the clock and the countdown agree on 55m.
    expect(lines[0]).toMatch(/^5-hour window: 81% used, resets \d{2}:00 \(in 55m\)$/);
    expect(lines[1]).toMatch(/^Weekly \(all models\): 33%, resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2} \(in 5d 22h\)$/);
    expect(lines[2]).toBe("Weekly Fable: 64%");
    expect(lines[3]).toBe("Updated 12s ago");
    expect(lines[4]).toBe("Plan: team (default_claude_max_5x)");
  });

  it("escalates the background at 75 and 90 percent of the five-hour window", () => {
    expect(severity({ fetchedAt, fiveHour: { pct: 74.9 }, scoped: [] })).toBeUndefined();
    expect(severity({ fetchedAt, fiveHour: { pct: 75 }, scoped: [] })).toBe("warning");
    expect(severity({ fetchedAt, fiveHour: { pct: 90 }, scoped: [] })).toBe("error");
    expect(severity({ fetchedAt, scoped: [] })).toBeUndefined();
  });
});

describe("credentials cache", () => {
  const token = (accessToken: string, expiresAt?: number): Credentials => ({ accessToken, expiresAt });

  it("reads once per token lifetime, again near expiry, and again after the server rejects it", async () => {
    const t0 = Date.parse("2026-10-15T10:00:00Z");
    const hour = 60 * 60 * 1000;
    let reads = 0;
    const cache = new CredentialsCache(async () => token(`tok-${++reads}`, t0 + hour));
    // Several polls inside the lifetime share one read.
    expect((await cache.get(t0))?.accessToken).toBe("tok-1");
    expect((await cache.get(t0 + 10 * 60_000))?.accessToken).toBe("tok-1");
    expect((await cache.get(t0 + 58 * 60_000))?.accessToken).toBe("tok-1");
    expect(reads).toBe(1);
    // Sixty seconds before expiry the next poll reads again.
    expect((await cache.get(t0 + 59 * 60_000))?.accessToken).toBe("tok-2");
    expect(reads).toBe(2);
    // A 401 or 403 drops the token, so the next poll reads again even though it looked fresh.
    const rejected = new UsageError("http", "HTTP 401.", 401);
    expect(rejected.unauthorized).toBe(true);
    expect(new UsageError("http", "HTTP 500.", 500).unauthorized).toBe(false);
    if (rejected.unauthorized) cache.invalidate();
    expect((await cache.get(t0 + 59 * 60_000))?.accessToken).toBe("tok-3");
    expect(reads).toBe(3);
  });

  it("keeps a token with no expiry until invalidated and retries when nothing was found", async () => {
    let reads = 0;
    let found = false;
    const cache = new CredentialsCache(async () => (found ? token(`tok-${++reads}`) : (reads++, undefined)));
    expect(await cache.get(0)).toBeUndefined();
    expect(await cache.get(1)).toBeUndefined();
    expect(reads).toBe(2);
    found = true;
    expect((await cache.get(2))?.accessToken).toBe("tok-3");
    expect((await cache.get(Number.MAX_SAFE_INTEGER))?.accessToken).toBe("tok-3");
    expect(reads).toBe(3);
    cache.invalidate();
    expect((await cache.get(3))?.accessToken).toBe("tok-4");
  });
});
