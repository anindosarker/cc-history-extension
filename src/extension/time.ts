import { formatHumanDate } from "../shared/time";

export { formatClock, formatFullDateTime, formatHumanDate, formatHumanDateTime } from "../shared/time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "4d ago", or a short locale date ("Sep 21", "Sep 21, 2025") beyond 30 days. */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatHumanDate(ts, { now });
}
