import { describe, expect, it } from "vitest";
import { summarizeToolUse } from "../src/shared/toolSummary";
import { formatHumanDate, relativeTime } from "../src/extension/time";

describe("tool summaries", () => {
  it("summarizes common tools", () => {
    expect(summarizeToolUse("Bash", { command: "git status", description: "Show status" })).toBe("Show status");
    expect(summarizeToolUse("Bash", { command: "git status\n&& ls" })).toBe("git status");
    expect(summarizeToolUse("Edit", { file_path: "/a.ts" })).toBe("/a.ts");
    expect(summarizeToolUse("Grep", { pattern: "foo.*bar" })).toBe("foo.*bar");
    expect(summarizeToolUse("Custom", { first: "value", second: 2 })).toBe("value");
    expect(summarizeToolUse("Custom", { n: 42 })).toBe("42");
    expect(summarizeToolUse("Custom", "weird")).toBe("");
  });
});

describe("relative time", () => {
  const now = Date.UTC(2026, 5, 15, 12);
  it("formats recent and old timestamps", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe("4d ago");
    // Beyond 30 days the tree shows a short locale date instead, with the year only when it differs.
    const old = now - 45 * 86_400_000;
    expect(relativeTime(old, now)).toBe(formatHumanDate(old, { now }));
    expect(relativeTime(old, now)).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
