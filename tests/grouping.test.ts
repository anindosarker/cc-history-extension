import { describe, expect, it } from "vitest";
import { groupByProject } from "../src/extension/indexScan";
import type { SessionMeta } from "../src/shared/types";

function meta(id: string, cwd: string, lastActivityAt: number, title = id): SessionMeta {
  return {
    sessionId: id,
    filePath: `/p/${id}.jsonl`,
    cwd,
    projectName: cwd.split("/").pop() ?? cwd,
    title,
    titleSource: "ai",
    messageCount: 1,
    filesChanged: 0,
    mtime: lastActivityAt,
    size: 1,
    lastActivityAt,
  };
}

describe("project grouping order", () => {
  const t = Date.UTC(2026, 0, 1, 12, 0, 0);
  it("orders by minute-rounded activity then title so small updates do not reorder", () => {
    const groups = groupByProject([
      meta("b", "/x/one", t + 20_000, "beta"),
      meta("a", "/x/one", t + 5_000, "alpha"),
      meta("c", "/x/one", t - 120_000, "gamma"),
      meta("d", "/x/two", t + 90_000, "delta"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["two", "one"]);
    expect(groups[1].sessions.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
  });
});
