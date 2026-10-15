import { ERROR_REASON_TEXT, formatAgo, formatResetAt, pct, relativeDuration } from "../../shared/usage";
import type { ScopedLimit, UsageLimit, UsageSnapshot } from "./usageClient";

export { ERROR_REASON_TEXT, formatAgo, formatResetAt, pct, relativeDuration };

export const WARN_PCT = 75;
export const ERROR_PCT = 90;

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

/** "warning" at 75%, "error" at 90% of the five-hour window; undefined below. */
export function severity(snap: UsageSnapshot): "warning" | "error" | undefined {
  const p = snap.fiveHour?.pct;
  if (p === undefined) return undefined;
  if (p >= ERROR_PCT) return "error";
  if (p >= WARN_PCT) return "warning";
  return undefined;
}
