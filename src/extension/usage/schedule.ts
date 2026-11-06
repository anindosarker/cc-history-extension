export const DEFAULT_INTERVAL_S = 900;
export const MIN_INTERVAL_S = 300;
/** Window focus or opening the usage panel refreshes only when the latest attempt is at least this old. */
export const FOCUS_STALE_MS = 5 * 60_000;
/** Another window's "fetching since" lock is honoured for this long; a manual refresh waits at most this long for its result. */
export const LOCK_MAX_AGE_MS = 30_000;
/** How often a manual refresh looks at the cache file while another window fetches. */
export const LOCK_POLL_MS = 500;
/** After any 429, no window fetches (manual included) for at least this long. */
export const RATE_LIMIT_HOLD_MS = 60_000;
/** After a reset time passes, poll this long after it so the server has rolled the window over. */
export const RESET_GRACE_MS = 10_000;

/** Clamp the configured interval to the allowed minimum, in milliseconds. */
export function intervalMs(seconds: unknown): number {
  const s = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : DEFAULT_INTERVAL_S;
  return Math.max(MIN_INTERVAL_S, Math.floor(s)) * 1000;
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

/** Next attempt after a 429: the server's Retry-After when it is longer than the poll interval, else the interval. */
export function rateLimitDelayMs(retryAfterMs: number | undefined, interval: number): number {
  return Math.max(retryAfterMs ?? 0, interval);
}

/** Set in the environment of test or headless instances: the widget stays off and nothing is fetched. */
export const DISABLE_ENV = "CC_HISTORY_DISABLE_USAGE";

export function usageDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env[DISABLE_ENV];
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}
