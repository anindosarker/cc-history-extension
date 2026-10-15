import {
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  type UsageLimitView,
  type UsageThresholds,
  type UsageView,
  type WeekSummary,
} from "../../shared/usage";
import type { UsageSnapshot } from "./usageClient";
import type { UsageState } from "./usagePoller";

/** Flatten a snapshot into labelled rows with their window lengths. */
export function limitRows(snap: UsageSnapshot): UsageLimitView[] {
  const rows: UsageLimitView[] = [];
  if (snap.fiveHour) {
    rows.push({ key: "fiveHour", label: "5-hour window", pct: snap.fiveHour.pct, resetsAt: snap.fiveHour.resetsAt, windowMs: FIVE_HOURS_MS });
  }
  if (snap.weekly) {
    rows.push({ key: "weekly", label: "Weekly (all models)", pct: snap.weekly.pct, resetsAt: snap.weekly.resetsAt, windowMs: SEVEN_DAYS_MS });
  }
  for (const s of snap.scoped) {
    rows.push({
      key: s.label,
      label: s.label === "Extra" ? "Extra usage" : `Weekly ${s.label}`,
      pct: s.pct,
      resetsAt: s.resetsAt,
      windowMs: SEVEN_DAYS_MS,
    });
  }
  return rows.map((r) => (r.resetsAt === undefined ? { key: r.key, label: r.label, pct: r.pct, windowMs: r.windowMs } : r));
}

export function toUsageView(state: UsageState, week: WeekSummary, thresholds?: UsageThresholds): UsageView {
  const view: UsageView = {
    limits: state.snapshot ? limitRows(state.snapshot) : [],
    refreshing: state.refreshing,
    week,
  };
  if (thresholds) view.thresholds = thresholds;
  if (state.snapshot) view.fetchedAt = state.snapshot.fetchedAt;
  if (state.plan) view.plan = state.plan;
  if (state.error) view.error = { reason: state.error.reason, message: state.error.message, at: state.error.at };
  if (state.paused) view.paused = true;
  if (state.manualWaitUntil !== undefined) view.waitUntil = state.manualWaitUntil;
  return view;
}
