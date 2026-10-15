import { describe, expect, it } from "vitest";
import { sessionTooltipLines } from "../src/extension/treeTooltip";
import type { SessionMeta } from "../src/shared/types";

const started = new Date(2026, 8, 21, 15, 17, 0).getTime();

const meta: SessionMeta = {
  sessionId: "abc-123",
  filePath: "/logs/abc-123.jsonl",
  cwd: "/Users/me/app",
  projectName: "app",
  title: "Fix the *tree* tooltip",
  titleSource: "prompt",
  messageCount: 12,
  filesChanged: 2,
  mtime: started,
  size: 10,
  startedAt: started,
  gitBranch: "feat/x_y",
};

describe("tree item tooltip", () => {
  it("shows the start time in the full locale form", () => {
    const lines = sessionTooltipLines(meta, "Running", { locale: "en-US" });
    expect(lines).toEqual([
      "**Fix the \\*tree\\* tooltip**",
      "Status: Running",
      "Started: Mon, Sep 21, 2026 · 3:17:00 PM",
      "Branch: feat/x\\_y",
      "Messages: 12",
      "Session: `abc-123`",
    ]);
  });

  it("uses the locale clock and skips empty lines", () => {
    const lines = sessionTooltipLines({ ...meta, gitBranch: undefined }, undefined, { locale: "de-DE" });
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^Started: .*15:17:00$/);
    expect(lines[1]).not.toContain("PM");
  });
});
