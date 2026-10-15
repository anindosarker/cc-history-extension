/** Types the usage panel and the host share. Host-only details (tokens, credentials) never appear here. */

export const FIVE_HOURS_MS = 5 * 3_600_000;
export const SEVEN_DAYS_MS = 7 * 86_400_000;

export type UsageErrorReason = "no-credentials" | "token-expired" | "http" | "network" | "parse";

export interface UsageLimitView {
  /** "fiveHour", "weekly", or the scoped label ("Fable", "Opus", "Sonnet", "Extra"); matches the status bar segments. */
  key: string;
  label: string;
  /** Percent of the window used. */
  pct: number;
  /** Epoch ms when the window resets. */
  resetsAt?: number;
  /** Length of the window, used for the even-pace marker. */
  windowMs: number;
}

export interface UsageFailureView {
  reason: UsageErrorReason;
  message: string;
  at: number;
}

export interface WeekSummary {
  /** Sessions whose first message is within the last seven days. */
  sessions: number;
  /** Messages across those sessions. */
  messages: number;
  topProjects: { name: string; sessions: number }[];
}

/** The colour rules the status bar follows, sent along so the panel's bars agree with it. */
export interface UsageThresholds {
  warnAt: number;
  errorAt: number;
  /** "max" colours every bar by its own value; "fiveHour" colours only the five-hour bar. */
  colorBy: "max" | "fiveHour";
}

export const DEFAULT_THRESHOLDS: UsageThresholds = { warnAt: 75, errorAt: 90, colorBy: "max" };

export type BarLevel = "warning" | "error" | undefined;

/** Colour level of one bar: extra usage is never coloured, and in fiveHour mode only the five-hour bar is. */
export function barLevel(limit: { key: string; pct: number }, t: UsageThresholds = DEFAULT_THRESHOLDS): BarLevel {
  if (limit.key === "Extra") return undefined;
  if (t.colorBy === "fiveHour" && limit.key !== "fiveHour") return undefined;
  if (limit.pct >= t.errorAt) return "error";
  if (limit.pct >= t.warnAt) return "warning";
  return undefined;
}

export interface UsageView {
  /** Last good reading, kept while errors come and go. */
  fetchedAt?: number;
  plan?: string;
  limits: UsageLimitView[];
  error?: UsageFailureView;
  refreshing: boolean;
  week: WeekSummary;
  /** Absent only from hosts older than the setting; the panel then uses the defaults. */
  thresholds?: UsageThresholds;
}

export type UsageWebviewToHost = { type: "usageRequest" } | { type: "usageRefresh" };
export type UsageHostToWebview = { type: "usageSnapshot"; view: UsageView };

export const ERROR_REASON_TEXT: Record<UsageErrorReason, string> = {
  "no-credentials": "No Claude Code credentials found. Run claude and sign in.",
  "token-expired": "Claude Code's session token has expired. Run claude to sign in again.",
  http: "The usage request was rejected.",
  network: "Could not reach the usage API.",
  parse: "The usage API returned something unexpected.",
};

/** How far through its window a limit is, 0 to 1, from the reset time and window length. */
export function elapsedFraction(resetsAt: number, windowMs: number, now: number): number {
  if (windowMs <= 0) return 0;
  const start = resetsAt - windowMs;
  return Math.min(1, Math.max(0, (now - start) / windowMs));
}

export const PACE_MIN_FRACTION = 0.05;
export const PACE_MAX_PCT = 999;

/** Usage at reset if the current rate holds; undefined early in the window when the ratio is noise. */
export function paceProjection(pct: number, elapsed: number): number | undefined {
  if (elapsed <= PACE_MIN_FRACTION) return undefined;
  return Math.min(PACE_MAX_PCT, pct / elapsed);
}

const DAY_MS = 86_400_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** "55m", "5h 22m", "5d 22h", "<1m". Negative values read as "now". */
export function relativeDuration(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** "12s ago", "3m ago", "2h ago" */
export function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function clock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MINUTE_MS = 60_000;

/**
 * "18:00 (in 55m)" within a day, "Wed 16:00 (in 5d 22h)" beyond. The API reports resets a few
 * hundred milliseconds short of the minute, so round to the nearest minute first; every surface
 * (status bar tooltip and usage panel) goes through here and shows the same clock.
 */
export function formatResetAt(resetsAt: number, now: number): string {
  const rounded = Math.round(resetsAt / MINUTE_MS) * MINUTE_MS;
  const d = new Date(rounded);
  const diff = rounded - Math.round(now / MINUTE_MS) * MINUTE_MS;
  const time = diff < DAY_MS ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
  return `${time} (in ${relativeDuration(diff)})`;
}
