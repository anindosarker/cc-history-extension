import type { SessionMeta } from "../shared/types";
import { activityMinute, type ProjectGroup } from "./indexScan";

/** Order of projects and of the sessions inside them (ccHistory.tree.sortBy). */
export type SortBy = "activity" | "name" | "sessions";

export const SORT_MODES: readonly SortBy[] = ["activity", "name", "sessions"];
export const DEFAULT_SORT_BY: SortBy = "activity";

export const SORT_LABEL: Record<SortBy, string> = {
  activity: "Last activity",
  name: "Name",
  sessions: "Session count",
};

export const SORT_DETAIL: Record<SortBy, string> = {
  activity: "Most recently active projects and sessions first",
  name: "Projects and sessions A to Z",
  sessions: "Projects with the most sessions first, sessions by last activity",
};

export function normalizeSortBy(value: unknown): SortBy {
  return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value)
    ? (value as SortBy)
    : DEFAULT_SORT_BY;
}

/** A row of the Sessions tree root: a project, or the divider between current and other projects. */
export type TreeRow = { kind: "project"; group: ProjectGroup; current: boolean } | { kind: "divider" };

export const DIVIDER_LABEL = "Other projects";

/**
 * Forward slashes, no trailing slash, and case-folded for Windows drive paths so a cwd
 * recorded by Claude Code compares equal to the workspace folder VS Code reports.
 */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  if (/^[a-zA-Z]:/.test(s)) s = s.toLowerCase();
  return s;
}

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  if (parent === "/") return child.startsWith("/");
  return child.startsWith(parent + "/");
}

/**
 * A project belongs to the current window when its cwd equals or is inside a workspace
 * folder (git worktrees checked out under the folder included), or when a workspace folder
 * is inside the project cwd (a monorepo opened at a subfolder).
 */
export function isCurrentProject(cwd: string, workspaceFolderPaths: readonly string[]): boolean {
  const c = normalizePath(cwd);
  return workspaceFolderPaths.some((f) => {
    const w = normalizePath(f);
    return isInside(c, w) || isInside(w, c);
  });
}

/** Splits projects into the ones belonging to the open workspace and the rest; the input order is kept. */
export function pinCurrentProjects<T extends { cwd: string }>(
  projects: readonly T[],
  workspaceFolderPaths: readonly string[],
): { current: T[]; other: T[] } {
  const current: T[] = [];
  const other: T[] = [];
  for (const p of projects) (isCurrentProject(p.cwd, workspaceFolderPaths) ? current : other).push(p);
  return { current, other };
}

/** Case-insensitive A to Z; names that differ only by case compare equal. */
function byNameBase(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/** Case-insensitive A to Z with a case-sensitive fallback so the order is total. */
function byName(a: string, b: string): number {
  return byNameBase(a, b) || a.localeCompare(b);
}

function minute(ts: number): number {
  return Math.floor(ts / 60_000);
}

/** A sorted copy of the projects. Ties fall through to the name and finally the cwd so the order is stable. */
export function sortProjects(projects: readonly ProjectGroup[], sortBy: SortBy): ProjectGroup[] {
  const out = [...projects];
  switch (sortBy) {
    case "name":
      out.sort((a, b) => byName(a.name, b.name) || byName(a.cwd, b.cwd));
      break;
    case "sessions":
      out.sort((a, b) => b.sessions.length - a.sessions.length || byName(a.name, b.name) || byName(a.cwd, b.cwd));
      break;
    default:
      // Minute granularity keeps rows from reordering while a session is being written to.
      out.sort(
        (a, b) => minute(b.lastActivityAt) - minute(a.lastActivityAt) || byName(a.name, b.name) || byName(a.cwd, b.cwd),
      );
  }
  return out;
}

/** A sorted copy of the sessions. "sessions" has no meaning for a single session and falls back to activity. */
export function sortSessions(sessions: readonly SessionMeta[], sortBy: SortBy): SessionMeta[] {
  const out = [...sessions];
  if (sortBy === "name") {
    out.sort(
      (a, b) => byNameBase(a.title, b.title) || activityMinute(b) - activityMinute(a) || byName(a.sessionId, b.sessionId),
    );
  } else {
    out.sort((a, b) => activityMinute(b) - activityMinute(a) || byName(a.title, b.title) || byName(a.sessionId, b.sessionId));
  }
  return out;
}

/**
 * The root rows of the Sessions tree: current projects first, then a divider, then the rest.
 * No divider and no pinning when nothing is current.
 */
export function buildTreeModel(
  projects: readonly ProjectGroup[],
  workspaceFolderPaths: readonly string[],
  sortBy: SortBy,
): TreeRow[] {
  const { current, other } = pinCurrentProjects(projects, workspaceFolderPaths);
  if (current.length === 0) return sortProjects(projects, sortBy).map((group) => ({ kind: "project", group, current: false }));
  const rows: TreeRow[] = sortProjects(current, sortBy).map((group) => ({ kind: "project", group, current: true }));
  if (other.length > 0) {
    rows.push({ kind: "divider" });
    for (const group of sortProjects(other, sortBy)) rows.push({ kind: "project", group, current: false });
  }
  return rows;
}
