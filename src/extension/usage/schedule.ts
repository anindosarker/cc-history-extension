export const DEFAULT_INTERVAL_S = 60;
export const MIN_INTERVAL_S = 30;
export const MAX_BACKOFF_MS = 10 * 60_000;

/** Clamp the configured interval to the allowed minimum, in milliseconds. */
export function intervalMs(seconds: unknown): number {
  const s = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : DEFAULT_INTERVAL_S;
  return Math.max(MIN_INTERVAL_S, Math.floor(s)) * 1000;
}

/** Delay before the next poll: the interval, doubled per consecutive failure, capped at ten minutes. */
export function nextDelayMs(interval: number, failures: number): number {
  if (failures <= 0) return interval;
  const factor = 2 ** Math.min(failures, 20);
  return Math.min(MAX_BACKOFF_MS, interval * factor);
}
