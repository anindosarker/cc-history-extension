import { ERROR_REASON_TEXT, formatAgo, formatResetAt, pct, relativeDuration } from "../../shared/usage";
import type { ScopedLimit, UsageLimit, UsageSnapshot } from "./usageClient";

export { ERROR_REASON_TEXT, formatAgo, formatResetAt, pct, relativeDuration };

export const WARN_PCT = 75;
export const ERROR_PCT = 90;

export type ColorMode = "background" | "text" | "off";
export type ColorBy = "max" | "fiveHour";
export type StatusFormat = "full" | "compact" | "max";
export type ColorLevel = "warning" | "error";

/** The pure, vscode-free part of the usage settings that drives status bar text and colour. */
export interface UsageDisplaySettings {
  warnAt: number;
  errorAt: number;
  colorMode: ColorMode;
  colorBy: ColorBy;
  format: StatusFormat;
  pulse: boolean;
}

export const DEFAULT_DISPLAY_SETTINGS: UsageDisplaySettings = {
  warnAt: WARN_PCT,
  errorAt: ERROR_PCT,
  colorMode: "background",
  colorBy: "max",
  format: "full",
  pulse: true,
};

export interface UsageSegment {
  /** "fiveHour", "weekly", or the scoped label ("Fable", "Opus", "Sonnet", "Extra"). */
  key: "fiveHour" | "weekly" | string;
  label: string;
  /** Short form used in the status bar: "5h", "wk", or the label's first letter. */
  short: string;
  pct: number;
}

export interface ColorDecision {
  level: ColorLevel | undefined;
  segment?: UsageSegment;
  /** "F 92% (error at 90%)", or "" when nothing is coloured. */
  reason: string;
}

// Extra usage is a paid overflow budget, so spending it is not a reason to alarm.
const EXTRA_KEY = "Extra";

function initial(label: string): string {
  return label.slice(0, 1).toUpperCase();
}

/** Every segment the status bar shows, in display order: 5h, wk, then each scoped share. */
export function segmentsOf(snap: UsageSnapshot): UsageSegment[] {
  const out: UsageSegment[] = [];
  if (snap.fiveHour) out.push({ key: "fiveHour", label: "5-hour window", short: "5h", pct: snap.fiveHour.pct });
  if (snap.weekly) out.push({ key: "weekly", label: "Weekly (all models)", short: "wk", pct: snap.weekly.pct });
  for (const s of snap.scoped) out.push({ key: s.label, label: s.label, short: initial(s.label), pct: s.pct });
  return out;
}

function highest(segments: UsageSegment[]): UsageSegment | undefined {
  let best: UsageSegment | undefined;
  for (const s of segments) if (!best || s.pct > best.pct) best = s;
  return best;
}

/** Which level the widget should be coloured at, and the segment that pushed it there. */
export function colorDecision(snap: UsageSnapshot, settings: UsageDisplaySettings): ColorDecision {
  const none: ColorDecision = { level: undefined, reason: "" };
  if (settings.colorMode === "off") return none;
  const segments = segmentsOf(snap);
  const candidates =
    settings.colorBy === "fiveHour"
      ? segments.filter((s) => s.key === "fiveHour")
      : segments.filter((s) => s.key !== EXTRA_KEY);
  const segment = highest(candidates);
  if (!segment) return none;
  const level: ColorLevel | undefined =
    segment.pct >= settings.errorAt ? "error" : segment.pct >= settings.warnAt ? "warning" : undefined;
  if (!level) return none;
  const threshold = level === "error" ? settings.errorAt : settings.warnAt;
  return { level, segment, reason: `${segment.short} ${pct(segment.pct)} (${level} at ${threshold}%)` };
}

/** "$(sparkle) 5h 81% · wk 33% · F 64%", omitting whatever the snapshot lacks. */
export function statusBarText(snap: UsageSnapshot): string {
  return statusBarItemText(snap, { ...DEFAULT_DISPLAY_SETTINGS, colorMode: "off" });
}

/** Status bar text per the format setting, with the pulse icon and warning marker at error level. */
export function statusBarItemText(snap: UsageSnapshot, settings: UsageDisplaySettings): string {
  const segments = segmentsOf(snap);
  const decision = colorDecision(snap, settings);
  const alarm = settings.pulse && decision.level === "error";
  const icon = alarm ? "$(pulse)" : "$(sparkle)";
  const top = highest(segments);
  const shown = settings.format === "max" ? (top ? [top] : []) : segments;
  const parts = shown.map((s) => {
    const body = settings.format === "compact" ? String(Math.round(s.pct)) : `${s.short} ${pct(s.pct)}`;
    return alarm && s.key === decision.segment?.key ? `$(warning) ${body}` : body;
  });
  return `${icon} ${parts.length ? parts.join(" · ") : "usage"}`;
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
  /** When set and coloured, adds a "Color: ..." line explaining why. */
  color?: ColorDecision;
}

/** One line per limit, then the colour reason (if any), freshness and plan. */
export function tooltipLines(snap: UsageSnapshot, ctx: TooltipContext): string[] {
  const lines: string[] = [];
  if (snap.fiveHour) lines.push(`5-hour window: ${pct(snap.fiveHour.pct)} used${withReset(snap.fiveHour, ctx.now)}`);
  if (snap.weekly) lines.push(`Weekly (all models): ${pct(snap.weekly.pct)}${withReset(snap.weekly, ctx.now)}`);
  for (const s of snap.scoped) lines.push(scopedLine(s));
  if (lines.length === 0) lines.push("No usage limits reported.");
  if (ctx.color?.level) lines.push(`Color: ${ctx.color.reason}`);
  lines.push(`Updated ${formatAgo(ctx.now - snap.fetchedAt)}`);
  if (ctx.plan) lines.push(`Plan: ${ctx.plan}`);
  return lines;
}

/** "warning" at 75%, "error" at 90% of the five-hour window; undefined below. */
export function severity(snap: UsageSnapshot): ColorLevel | undefined {
  return colorDecision(snap, { ...DEFAULT_DISPLAY_SETTINGS, colorBy: "fiveHour" }).level;
}
