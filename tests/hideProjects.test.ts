import { describe, expect, it } from "vitest";
import { DEFAULT_HIDDEN_PROJECTS, isHiddenProject, visibleSessions } from "../src/extension/hideProjects";
import { groupByProject } from "../src/extension/indexScan";
import { weekSummary } from "../src/extension/usage/weekSummary";
import type { SessionMeta } from "../src/shared/types";

const now = Date.UTC(2026, 9, 15, 12, 0, 0);

function meta(id: string, cwd: string): SessionMeta {
  return {
    sessionId: id,
    filePath: `/logs/${id}.jsonl`,
    cwd,
    projectName: cwd.split("/").filter(Boolean).pop() ?? cwd,
    title: id,
    titleSource: "id",
    messageCount: 3,
    filesChanged: 0,
    mtime: now - 60_000,
    size: 1,
    startedAt: now - 60_000,
  };
}

describe("hideProjects matcher", () => {
  it("matches a cwd against any pattern, including nested folders under **", () => {
    expect(isHiddenProject("/private/var/folders/ab/T/tmp.xyz", DEFAULT_HIDDEN_PROJECTS)).toBe(true);
    expect(isHiddenProject("/tmp/scratch", DEFAULT_HIDDEN_PROJECTS)).toBe(true);
    expect(isHiddenProject("/tmp/.hidden/deep/er", DEFAULT_HIDDEN_PROJECTS)).toBe(true);
    expect(isHiddenProject("/Users/me/work/app", ["**/work/*"])).toBe(true);
  });

  it("does not match unrelated paths or partial segment matches", () => {
    expect(isHiddenProject("/Users/me/Work/app", DEFAULT_HIDDEN_PROJECTS)).toBe(false);
    expect(isHiddenProject("/tmpfiles/app", DEFAULT_HIDDEN_PROJECTS)).toBe(false);
    expect(isHiddenProject("/Users/me/private/var/folders", DEFAULT_HIDDEN_PROJECTS)).toBe(false);
  });

  it("hides nothing with an empty, blank or invalid pattern list", () => {
    expect(isHiddenProject("/tmp/scratch", [])).toBe(false);
    expect(isHiddenProject("/tmp/scratch", ["", "   "])).toBe(false);
    expect(isHiddenProject("/tmp/scratch", ["[unclosed"])).toBe(false);
  });

  it("normalises Windows separators on both sides", () => {
    expect(isHiddenProject("C:\\Users\\me\\AppData\\Local\\Temp\\x", ["C:/Users/**/Temp/**"])).toBe(true);
    expect(isHiddenProject("C:/Users/me/AppData/Local/Temp/x", ["C:\\Users\\**\\Temp\\**"])).toBe(true);
  });
});

describe("tree and week summary hide matching projects", () => {
  const sessions = [
    meta("a", "/Users/me/work/app"),
    meta("b", "/private/var/folders/zz/T/tmp.abc"),
    meta("c", "/tmp/scratch"),
    meta("d", "/Users/me/work/app"),
  ];

  it("drops every session of a hidden project from the project groups", () => {
    const groups = groupByProject(visibleSessions(sessions, DEFAULT_HIDDEN_PROJECTS));
    expect(groups.map((g) => g.cwd)).toEqual(["/Users/me/work/app"]);
    expect(groups[0].sessions.map((s) => s.sessionId).sort()).toEqual(["a", "d"]);
  });

  it("keeps every project when nothing is hidden", () => {
    const groups = groupByProject(visibleSessions(sessions, []));
    expect(groups).toHaveLength(3);
  });

  it("leaves hidden projects out of the week summary", () => {
    const s = weekSummary(visibleSessions(sessions, DEFAULT_HIDDEN_PROJECTS), now);
    expect(s.sessions).toBe(2);
    expect(s.topProjects).toEqual([{ name: "app", sessions: 2 }]);
  });
});
