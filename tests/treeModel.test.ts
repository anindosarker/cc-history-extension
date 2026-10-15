import { describe, expect, it } from "vitest";
import { groupByProject, type ProjectGroup } from "../src/extension/indexScan";
import {
  buildTreeModel,
  DIVIDER_LABEL,
  isCurrentProject,
  normalizeSortBy,
  pinCurrentProjects,
  sortProjects,
  sortSessions,
  type TreeRow,
} from "../src/extension/treeModel";
import type { SessionMeta } from "../src/shared/types";

const t = Date.UTC(2026, 9, 15, 12, 0, 0);
const MIN = 60_000;

function meta(id: string, cwd: string, lastActivityAt: number, title = id): SessionMeta {
  return {
    sessionId: id,
    filePath: `/p/${id}.jsonl`,
    cwd,
    projectName: cwd.split("/").filter(Boolean).pop() ?? cwd,
    title,
    titleSource: "ai",
    messageCount: 1,
    filesChanged: 0,
    mtime: lastActivityAt,
    size: 1,
    lastActivityAt,
  };
}

function group(cwd: string, sessions: SessionMeta[]): ProjectGroup {
  return groupByProject(sessions.map((s) => ({ ...s, cwd, projectName: cwd.split("/").pop() ?? cwd })))[0];
}

const ws = "/Users/me/Work/app";

describe("pinCurrentProjects", () => {
  it("treats an equal cwd as current", () => {
    expect(isCurrentProject(ws, [ws])).toBe(true);
    expect(isCurrentProject(ws + "/", [ws])).toBe(true);
  });

  it("treats a cwd nested inside a workspace folder as current", () => {
    expect(isCurrentProject(ws + "/packages/web", [ws])).toBe(true);
  });

  it("treats a workspace folder inside the project cwd as current (monorepo opened at a subfolder)", () => {
    expect(isCurrentProject("/Users/me/Work", [ws])).toBe(true);
  });

  it("counts git worktrees checked out under the workspace", () => {
    expect(isCurrentProject(ws + "/.claude/worktrees/feature-x", [ws])).toBe(true);
    expect(isCurrentProject(ws + "/.worktrees/hotfix", [ws])).toBe(true);
  });

  it("does not match a sibling that only shares a path prefix", () => {
    expect(isCurrentProject(ws + "-old", [ws])).toBe(false);
    expect(isCurrentProject("/Users/me/Work/application", [ws])).toBe(false);
    expect(isCurrentProject("/Users/me/Other", [ws])).toBe(false);
  });

  it("matches against any of several workspace folders, including Windows paths", () => {
    expect(isCurrentProject("/Users/me/Other/lib", [ws, "/Users/me/Other"])).toBe(true);
    expect(isCurrentProject("C:\\Work\\App\\src", ["c:/work/app"])).toBe(true);
  });

  it("splits projects keeping the input order and leaves everything in other when nothing is current", () => {
    const projects = [{ cwd: "/a" }, { cwd: ws + "/x" }, { cwd: "/b" }, { cwd: ws }];
    expect(pinCurrentProjects(projects, [ws])).toEqual({
      current: [{ cwd: ws + "/x" }, { cwd: ws }],
      other: [{ cwd: "/a" }, { cwd: "/b" }],
    });
    expect(pinCurrentProjects(projects, [])).toEqual({ current: [], other: projects });
    expect(pinCurrentProjects(projects, ["/nowhere"])).toEqual({ current: [], other: projects });
  });
});

describe("sortProjects", () => {
  const alpha = group("/x/alpha", [meta("a1", "/x/alpha", t - 5 * MIN), meta("a2", "/x/alpha", t - 9 * MIN)]);
  const beta = group("/x/beta", [meta("b1", "/x/beta", t - 1 * MIN)]);
  const Gamma = group("/y/Gamma", [
    meta("g1", "/y/Gamma", t - 5 * MIN + 10_000),
    meta("g2", "/y/Gamma", t - 50 * MIN),
    meta("g3", "/y/Gamma", t - 60 * MIN),
  ]);
  const delta = group("/x/delta", [meta("d1", "/x/delta", t - 5 * MIN)]);
  const input = [Gamma, alpha, delta, beta];

  it("activity: most recent first, same minute ties broken by name", () => {
    expect(sortProjects(input, "activity").map((g) => g.name)).toEqual(["beta", "alpha", "delta", "Gamma"]);
  });

  it("name: A to Z, case-insensitive", () => {
    expect(sortProjects(input, "name").map((g) => g.name)).toEqual(["alpha", "beta", "delta", "Gamma"]);
  });

  it("sessions: most sessions first, ties by name", () => {
    expect(sortProjects(input, "sessions").map((g) => g.name)).toEqual(["Gamma", "alpha", "beta", "delta"]);
  });

  it("name ties fall through to the cwd and the input is not mutated", () => {
    const one = group("/one/app", [meta("o", "/one/app", t)]);
    const two = group("/two/app", [meta("w", "/two/app", t)]);
    const list = [two, one];
    expect(sortProjects(list, "name").map((g) => g.cwd)).toEqual(["/one/app", "/two/app"]);
    expect(list.map((g) => g.cwd)).toEqual(["/two/app", "/one/app"]);
  });

  it("normalizes unknown sort values to activity", () => {
    expect(normalizeSortBy("name")).toBe("name");
    expect(normalizeSortBy("bogus")).toBe("activity");
    expect(normalizeSortBy(undefined)).toBe("activity");
  });
});

describe("sortSessions", () => {
  const sessions = [
    meta("s1", "/x", t - 3 * MIN, "zeta"),
    meta("s2", "/x", t - 1 * MIN, "Beta"),
    meta("s3", "/x", t - 1 * MIN + 20_000, "alpha"),
    meta("s4", "/x", t - 30 * MIN, "beta"),
  ];

  it("activity: newest first at minute granularity, ties by title", () => {
    expect(sortSessions(sessions, "activity").map((s) => s.sessionId)).toEqual(["s3", "s2", "s1", "s4"]);
  });

  it("name: title A to Z, case-insensitive, equal titles by activity", () => {
    expect(sortSessions(sessions, "name").map((s) => s.sessionId)).toEqual(["s3", "s2", "s4", "s1"]);
  });

  it("sessions mode falls back to activity", () => {
    expect(sortSessions(sessions, "sessions")).toEqual(sortSessions(sessions, "activity"));
  });
});

describe("buildTreeModel", () => {
  const app = group(ws, [meta("w1", ws, t - 40 * MIN)]);
  const wt = group(ws + "/.claude/worktrees/feat", [meta("w2", ws + "/.claude/worktrees/feat", t - 2 * MIN)]);
  const other1 = group("/Users/me/Other/one", [meta("o1", "/Users/me/Other/one", t - 1 * MIN)]);
  const other2 = group("/Users/me/Other/two", [
    meta("o2", "/Users/me/Other/two", t - 90 * MIN),
    meta("o3", "/Users/me/Other/two", t - 95 * MIN),
  ]);
  const projects = [other1, wt, app, other2];

  const labels = (rows: TreeRow[]) => rows.map((r) => (r.kind === "divider" ? DIVIDER_LABEL : r.group.name));

  it("pins current projects first, then the divider, then the rest, each sorted by activity", () => {
    const rows = buildTreeModel(projects, [ws], "activity");
    expect(labels(rows)).toEqual(["feat", "app", DIVIDER_LABEL, "one", "two"]);
    expect(rows.map((r) => r.kind === "project" && r.current)).toEqual([true, true, false, false, false]);
  });

  it("applies the same sort inside the pinned set and the rest", () => {
    expect(labels(buildTreeModel(projects, [ws], "name"))).toEqual(["app", "feat", DIVIDER_LABEL, "one", "two"]);
    expect(labels(buildTreeModel(projects, [ws], "sessions"))).toEqual(["app", "feat", DIVIDER_LABEL, "two", "one"]);
  });

  it("shows no divider and pins nothing when no project is current", () => {
    const rows = buildTreeModel(projects, ["/elsewhere"], "activity");
    expect(labels(rows)).toEqual(["one", "feat", "app", "two"]);
    expect(rows.every((r) => r.kind === "project" && !r.current)).toBe(true);
    expect(labels(buildTreeModel(projects, [], "activity"))).toEqual(["one", "feat", "app", "two"]);
  });

  it("shows no divider when every project is current", () => {
    expect(labels(buildTreeModel([app, wt], [ws], "activity"))).toEqual(["feat", "app"]);
  });

  it("is empty for no projects", () => {
    expect(buildTreeModel([], [ws], "activity")).toEqual([]);
  });
});
