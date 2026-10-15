export const DEFAULT_INTERVAL_S = 60;
export const MIN_INTERVAL_S = 30;
/** Backoff ceiling for network and server failures; credential problems retry on a fixed short cycle instead. */
export const MAX_BACKOFF_MS = 5 * 60_000;
/** Retry cycle while the token is missing, expired or rejected: Claude Code rotates it on its own. */
export const CREDENTIAL_RETRY_MS = 30_000;

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
