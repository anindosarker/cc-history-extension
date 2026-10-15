import * as os from "node:os";
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

/** The divider between current and other projects is a thin rule: an empty label and a run of box-drawing dashes. */
export const DIVIDER_LABEL = "";
export const DIVIDER_RULE = "\u2500".repeat(40);
export const DIVIDER_TOOLTIP = "Projects outside the current workspace";

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

export interface PinOptions {
  /** Whether a path is a repository root (holds a .git entry). Without it, no ancestor project is pinned. */
  isRepoRoot?: (path: string) => boolean;
  /** The user's home folder; defaults to the OS home directory. */
  homeDir?: string;
}

/** Folders whose direct children are user or volume roots, never a project that owns a workspace. */
const ROOT_PARENTS = new Set(["/", "/users", "/home", "/volumes"]);

/**
 * Whether a project that contains a workspace folder may count as current: not the home folder,
 * not the filesystem root or a direct child of it (or of /Users, /home, /Volumes), and a repository root.
 */
function ancestorMayPin(cwd: string, normalized: string, opts: PinOptions): boolean {
  if (normalized === "/") return false;
  if (normalized === normalizePath(opts.homeDir ?? os.homedir())) return false;
  const parent = normalized.slice(0, normalized.lastIndexOf("/")) || "/";
  if (ROOT_PARENTS.has(parent.toLowerCase())) return false;
  return opts.isRepoRoot?.(cwd) === true;
}

/**
 * A project belongs to the current window when its cwd equals or is inside a workspace
 * folder (git worktrees checked out under the folder included), or when a workspace folder
 * is inside the project cwd (a monorepo opened at a subfolder) and the cwd is a repository root
 * rather than the home folder or another ancestor of everything.
 */
export function isCurrentProject(cwd: string, workspaceFolderPaths: readonly string[], opts: PinOptions = {}): boolean {
  const c = normalizePath(cwd);
  return workspaceFolderPaths.some((f) => {
    const w = normalizePath(f);
    if (isInside(c, w)) return true;
    return c !== w && isInside(w, c) && ancestorMayPin(cwd, c, opts);
  });
}

/** Splits projects into the ones belonging to the open workspace and the rest; the input order is kept. */
export function pinCurrentProjects<T extends { cwd: string }>(
  projects: readonly T[],
  workspaceFolderPaths: readonly string[],
  opts: PinOptions = {},
): { current: T[]; other: T[] } {
  const current: T[] = [];
  const other: T[] = [];
  for (const p of projects) (isCurrentProject(p.cwd, workspaceFolderPaths, opts) ? current : other).push(p);
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
  opts: PinOptions = {},
): TreeRow[] {
  const { current, other } = pinCurrentProjects(projects, workspaceFolderPaths, opts);
  if (current.length === 0) return sortProjects(projects, sortBy).map((group) => ({ kind: "project", group, current: false }));
  const rows: TreeRow[] = sortProjects(current, sortBy).map((group) => ({ kind: "project", group, current: true }));
  if (other.length > 0) {
    rows.push({ kind: "divider" });
    for (const group of sortProjects(other, sortBy)) rows.push({ kind: "project", group, current: false });
  }
  return rows;
}
