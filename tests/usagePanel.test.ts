import { describe, expect, it } from "vitest";
import { limitRows, toUsageView } from "../src/extension/usage/usageView";
import { weekSummary } from "../src/extension/usage/weekSummary";
import type { SessionMeta } from "../src/shared/types";
import { barLevel, elapsedFraction, FIVE_HOURS_MS, paceProjection, SEVEN_DAYS_MS } from "../src/shared/usage";

const now = Date.UTC(2026, 9, 15, 12, 0, 0);
const hour = 3_600_000;
const day = 86_400_000;

describe("pace projection", () => {
  it("measures how far through the window a limit is from its reset time", () => {
    expect(elapsedFraction(now + 4 * hour, FIVE_HOURS_MS, now)).toBeCloseTo(0.2);
    expect(elapsedFraction(now + 1 * hour, FIVE_HOURS_MS, now)).toBeCloseTo(0.8);
    expect(elapsedFraction(now + 6 * day, SEVEN_DAYS_MS, now)).toBeCloseTo(1 / 7);
    // Past the reset or before the window clamps to the edges.
    expect(elapsedFraction(now - hour, FIVE_HOURS_MS, now)).toBe(1);
    expect(elapsedFraction(now + 10 * hour, FIVE_HOURS_MS, now)).toBe(0);
    expect(elapsedFraction(now, 0, now)).toBe(0);
  });

  it("projects usage at reset from the current rate, hidden early and clamped high", () => {
    expect(paceProjection(81, 0.8)).toBeCloseTo(101.25);
    expect(paceProjection(33, 1 / 7)).toBeCloseTo(231);
    expect(paceProjection(10, 0.05)).toBeUndefined();
    expect(paceProjection(10, 0.01)).toBeUndefined();
    expect(paceProjection(90, 0.06)).toBe(999);
    expect(paceProjection(0, 0.5)).toBe(0);
  });
});

function meta(id: string, project: string, startedAt: number, messageCount = 4): SessionMeta {
  return {
    sessionId: id,
    filePath: `/p/${id}.jsonl`,
    cwd: `/home/me/${project}`,
    projectName: project,
    title: id,
    titleSource: "ai",
    messageCount,
    filesChanged: 0,
    mtime: startedAt,
    size: 1,
    startedAt,
  };
}

describe("week summary", () => {
  it("counts sessions started in the last seven days and ranks projects", () => {
    const sessions = [
      meta("a", "alpha", now - 1 * day, 10),
      meta("b", "alpha", now - 2 * day, 5),
      meta("c", "beta", now - 3 * day, 1),
      meta("d", "gamma", now - 6 * day + hour, 2),
      meta("e", "gamma", now - 7 * day - hour, 100),
      meta("f", "delta", now - 8 * day, 100),
      meta("g", "beta", now + day, 100),
    ];
    const s = weekSummary(sessions, now);
    expect(s.sessions).toBe(4);
    expect(s.messages).toBe(18);
    expect(s.topProjects).toEqual([
      { name: "alpha", sessions: 2 },
      { name: "beta", sessions: 1 },
      { name: "gamma", sessions: 1 },
    ]);
  });

  it("falls back to the file mtime when a session has no start time and handles an empty index", () => {
    const noStart: SessionMeta = { ...meta("x", "p", now - day), startedAt: undefined };
    expect(weekSummary([noStart], now).sessions).toBe(1);
    expect(weekSummary([], now)).toEqual({ sessions: 0, messages: 0, topProjects: [] });
  });
});

describe("usage view mapping", () => {
  it("turns a snapshot into labelled rows with window lengths", () => {
    const rows = limitRows({
      fetchedAt: now,
      fiveHour: { pct: 81, resetsAt: now + hour },
      weekly: { pct: 33, resetsAt: now + 5 * day },
      scoped: [
        { label: "Fable", pct: 64, resetsAt: now + 5 * day },
        { label: "Extra", pct: 3 },
      ],
    });
    expect(rows).toEqual([
      { key: "fiveHour", label: "5-hour window", pct: 81, resetsAt: now + hour, windowMs: FIVE_HOURS_MS },
      { key: "weekly", label: "Weekly (all models)", pct: 33, resetsAt: now + 5 * day, windowMs: SEVEN_DAYS_MS },
      { key: "Fable", label: "Weekly Fable", pct: 64, resetsAt: now + 5 * day, windowMs: SEVEN_DAYS_MS },
      { key: "Extra", label: "Extra usage", pct: 3, windowMs: SEVEN_DAYS_MS },
    ]);
  });

  it("carries the error and the last good reading side by side", () => {
    const week = { sessions: 0, messages: 0, topProjects: [] };
    const view = toUsageView(
      {
        snapshot: { fetchedAt: now - 60_000, fiveHour: { pct: 50 }, scoped: [] },
        error: { reason: "network", message: "ECONNRESET", at: now },
        plan: "team",
        refreshing: false,
      },
      week,
    );
    expect(view.fetchedAt).toBe(now - 60_000);
    expect(view.limits).toHaveLength(1);
    expect(view.error).toEqual({ reason: "network", message: "ECONNRESET", at: now });
    expect(view.plan).toBe("team");
    expect(toUsageView({ refreshing: true }, week)).toEqual({ limits: [], refreshing: true, week });
    // The status bar's thresholds ride along so the panel colours its bars the same way.
    const t = { warnAt: 50, errorAt: 60, colorBy: "fiveHour" as const };
    expect(toUsageView({ refreshing: false }, week, t).thresholds).toEqual(t);
  });

  it("colours a bar by the host's thresholds and colour source", () => {
    const custom = { warnAt: 50, errorAt: 60, colorBy: "max" as const };
    expect(barLevel({ key: "fiveHour", pct: 49.9 }, custom)).toBeUndefined();
    expect(barLevel({ key: "fiveHour", pct: 50 }, custom)).toBe("warning");
    expect(barLevel({ key: "weekly", pct: 55 }, custom)).toBe("warning");
    expect(barLevel({ key: "Fable", pct: 60 }, custom)).toBe("error");
    expect(barLevel({ key: "Fable", pct: 99 }, custom)).toBe("error");
    // Extra usage is never coloured, matching the status bar's decision.
    expect(barLevel({ key: "Extra", pct: 99 }, custom)).toBeUndefined();
    // In fiveHour mode only the five-hour bar carries colour.
    const fiveHour = { ...custom, colorBy: "fiveHour" as const };
    expect(barLevel({ key: "fiveHour", pct: 95 }, fiveHour)).toBe("error");
    expect(barLevel({ key: "weekly", pct: 95 }, fiveHour)).toBeUndefined();
    expect(barLevel({ key: "Fable", pct: 95 }, fiveHour)).toBeUndefined();
    // Defaults are the status bar's 75 and 90.
    expect(barLevel({ key: "weekly", pct: 75 })).toBe("warning");
    expect(barLevel({ key: "weekly", pct: 90 })).toBe("error");
    expect(barLevel({ key: "weekly", pct: 74 })).toBeUndefined();
  });
});
