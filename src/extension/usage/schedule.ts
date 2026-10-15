export const DEFAULT_INTERVAL_S = 300;
export const MIN_INTERVAL_S = 120;
/** Backoff ceiling for network and server failures; credential problems retry on a fixed short cycle instead. */
export const MAX_BACKOFF_MS = 5 * 60_000;
/** Retry cycle while the token is missing, expired or rejected: Claude Code rotates it on its own. */
export const CREDENTIAL_RETRY_MS = 30_000;
/** After a 429 the next attempt waits at least this long, doubling per consecutive 429 up to the ceiling. */
export const RATE_LIMIT_MIN_MS = 15 * 60_000;
export const RATE_LIMIT_MAX_MS = 2 * 3_600_000;
/** Consecutive 429s after which automatic polling stops until the user clicks Refresh. */
export const RATE_LIMIT_PAUSE_AFTER = 3;
/** Manual refreshes (button, Retry, command) are allowed at most once per this long. */
export const MANUAL_MIN_GAP_MS = 60_000;
/** Another window's "fetching since" lock is honoured for this long. */
export const LOCK_MAX_AGE_MS = 30_000;

/** Clamp the configured interval to the allowed minimum, in milliseconds. */
export function intervalMs(seconds: unknown): number {
  const s = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : DEFAULT_INTERVAL_S;
  return Math.max(MIN_INTERVAL_S, Math.floor(s)) * 1000;
}

/** Delay before the next poll: the interval, doubled per consecutive failure, capped at five minutes. */
export function nextDelayMs(interval: number, failures: number): number {
  if (failures <= 0) return interval;
  const factor = 2 ** Math.min(failures, 20);
  return Math.min(MAX_BACKOFF_MS, interval * factor);
}

/** A Retry-After header as milliseconds from now: delay seconds or an HTTP date. Undefined when unusable. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | undefined {
  if (!header) return undefined;
  const s = header.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, t - now);
}

/**
 * Wait after the n-th consecutive 429: at least Retry-After, at least fifteen minutes, doubling per
 * consecutive 429 (15m, 30m, 1h, 2h) and never more than two hours.
 */
export function rateLimitDelayMs(retryAfterMs: number | undefined, consecutive: number): number {
  const n = Math.max(1, consecutive);
  const backoff = Math.min(RATE_LIMIT_MAX_MS, RATE_LIMIT_MIN_MS * 2 ** Math.min(n - 1, 10));
  return Math.min(RATE_LIMIT_MAX_MS, Math.max(backoff, retryAfterMs ?? 0));
}

/** Automatic polling stops once this many 429s arrived in a row. */
export function pausedAfter(consecutive: number): boolean {
  return consecutive >= RATE_LIMIT_PAUSE_AFTER;
}

/**
 * Whether a manual refresh may fetch now, given when the last one did. Returns the time the next
 * one is allowed, or undefined when it is allowed right away.
 */
export function manualWaitUntil(lastManualAt: number | undefined, now: number): number | undefined {
  if (lastManualAt === undefined) return undefined;
  const until = lastManualAt + MANUAL_MIN_GAP_MS;
  return until > now ? until : undefined;
}

/** Set in the environment of test or headless instances: the widget stays off and nothing is fetched. */
export const DISABLE_ENV = "CC_HISTORY_DISABLE_USAGE";

export function usageDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[DISABLE_ENV];
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}
