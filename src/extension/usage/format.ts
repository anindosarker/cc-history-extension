import type { ScopedLimit, UsageErrorReason, UsageLimit, UsageSnapshot } from "./usageClient";

export const WARN_PCT = 75;
export const ERROR_PCT = 90;

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

/** "18:00 (in 55m)" within a day, "Wed 16:00 (in 5d 22h)" beyond. */
export function formatResetAt(resetsAt: number, now: number): string {
  const d = new Date(resetsAt);
  const diff = resetsAt - now;
  const time = diff < DAY_MS ? clock(d) : `${DAYS[d.getDay()]} ${clock(d)}`;
  return `${time} (in ${relativeDuration(diff)})`;
}

function initial(label: string): string {
  return label.slice(0, 1).toUpperCase();
}

/** "$(sparkle) 5h 81% · wk 33% · F 64%", omitting whatever the snapshot lacks. */
export function statusBarText(snap: UsageSnapshot): string {
  const parts: string[] = [];
  if (snap.fiveHour) parts.push(`5h ${pct(snap.fiveHour.pct)}`);
  if (snap.weekly) parts.push(`wk ${pct(snap.weekly.pct)}`);
  for (const s of snap.scoped) parts.push(`${initial(s.label)} ${pct(s.pct)}`);
  return `$(sparkle) ${parts.length ? parts.join(" · ") : "usage"}`;
}

export const STATUS_ERROR_TEXT = "$(sparkle) usage ?";

function withReset(l: UsageLimit, now: number): string {
  return l.resetsAt !== undefined ? `, resets ${formatResetAt(l.resetsAt, now)}` : "";
}

function scopedLine(s: ScopedLimit): string {
  return s.label === "Extra" ? `Extra usage: ${pct(s.pct)}` : `Weekly ${s.label}: ${pct(s.pct)}`;
}

export interface TooltipContext {
  now: number;
  plan?: string;
}

/** One line per limit, then freshness and plan. */
export function tooltipLines(snap: UsageSnapshot, ctx: TooltipContext): string[] {
  const lines: string[] = [];
  if (snap.fiveHour) lines.push(`5-hour window: ${pct(snap.fiveHour.pct)} used${withReset(snap.fiveHour, ctx.now)}`);
  if (snap.weekly) lines.push(`Weekly (all models): ${pct(snap.weekly.pct)}${withReset(snap.weekly, ctx.now)}`);
  for (const s of snap.scoped) lines.push(scopedLine(s));
  if (lines.length === 0) lines.push("No usage limits reported.");
  lines.push(`Updated ${formatAgo(ctx.now - snap.fetchedAt)}`);
  if (ctx.plan) lines.push(`Plan: ${ctx.plan}`);
  return lines;
}

export const ERROR_REASON_TEXT: Record<UsageErrorReason, string> = {
  "no-credentials": "No Claude Code credentials found. Run claude and sign in.",
  "token-expired": "Claude Code's session token has expired. Run claude to sign in again.",
  http: "The usage request was rejected.",
  network: "Could not reach the usage API.",
  parse: "The usage API returned something unexpected.",
};

/** "warning" at 75%, "error" at 90% of the five-hour window; undefined below. */
export function severity(snap: UsageSnapshot): "warning" | "error" | undefined {
  const p = snap.fiveHour?.pct;
  if (p === undefined) return undefined;
  if (p >= ERROR_PCT) return "error";
  if (p >= WARN_PCT) return "warning";
  return undefined;
}
