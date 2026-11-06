import {
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  type UsageLimitView,
  type UsageThresholds,
  type UsageView,
} from "../../shared/usage";
import { usableSnapshot } from "./format";
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

export function toUsageView(state: UsageState, thresholds?: UsageThresholds, now = Date.now()): UsageView {
  // A reading over an hour old, or one whose window has reset, is dropped rather than shown.
  const snapshot = usableSnapshot(state.snapshot, now);
  const view: UsageView = {
    limits: snapshot ? limitRows(snapshot) : [],
    refreshing: state.refreshing,
  };
  if (thresholds) view.thresholds = thresholds;
  if (snapshot) view.fetchedAt = snapshot.fetchedAt;
  if (state.plan) view.plan = state.plan;
  if (state.account) view.account = state.account;
  if (state.error) {
    view.error = { reason: state.error.reason, message: state.error.message, at: state.error.at };
    if (state.error.status !== undefined) view.error.status = state.error.status;
  }
  if (state.retryUntil !== undefined && state.retryUntil > now) view.retryUntil = state.retryUntil;
  return view;
}
