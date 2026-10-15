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

/** Why a project sits above the sort order: it belongs to the open workspace, or the user pinned it. */
export type PinSource = "workspace" | "manual";

/** A row of the Sessions tree root: a project, with whether it is current and whether it is pinned. */
export type TreeRow = { kind: "project"; group: ProjectGroup; current: boolean; pinned: boolean; pinSource?: PinSource };

/** Manual choices kept in workspaceState: cwds pinned by hand, and current cwds unpinned by hand. */
export interface ManualPins {
  pins: readonly string[];
  unpins: readonly string[];
}

export const NO_MANUAL_PINS: ManualPins = { pins: [], unpins: [] };

export interface PinState {
  cwd: string;
  /** Belongs to the open workspace (isCurrentProject). */
  current: boolean;
  /** Shown above the sort order. */
  pinned: boolean;
  pinSource?: PinSource;
}


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

function pathSet(paths: readonly string[]): Set<string> {
  return new Set(paths.map(normalizePath));
}

/**
 * Pinned state per project, in input order: a manual pin always pins; a current project is pinned
 * unless it was unpinned by hand; anything else is unpinned.
 */
export function resolvePinned<T extends { cwd: string }>(
  projects: readonly T[],
  workspaceFolderPaths: readonly string[],
  manual: ManualPins = NO_MANUAL_PINS,
  opts: PinOptions = {},
): (PinState & { project: T })[] {
  const pins = pathSet(manual.pins);
  const unpins = pathSet(manual.unpins);
  return projects.map((project) => {
    const key = normalizePath(project.cwd);
    const current = isCurrentProject(project.cwd, workspaceFolderPaths, opts);
    const state: PinState & { project: T } = { cwd: project.cwd, current, pinned: false, project };
    if (pins.has(key)) {
      state.pinned = true;
      state.pinSource = "manual";
    } else if (current && !unpins.has(key)) {
      state.pinned = true;
      state.pinSource = "workspace";
    }
    return state;
  });
}

/**
 * The manual lists after pinning or unpinning one project. Pinning a current project only forgets
 * its unpin; pinning another adds it. Unpinning forgets a manual pin, and for a current project
 * records the unpin so the workspace rule stops applying.
 */
export function togglePin(action: "pin" | "unpin", cwd: string, current: boolean, manual: ManualPins): ManualPins {
  const key = normalizePath(cwd);
  const without = (list: readonly string[]) => list.filter((p) => normalizePath(p) !== key);
  if (action === "pin") {
    return { pins: current ? without(manual.pins) : [...without(manual.pins), cwd], unpins: without(manual.unpins) };
  }
  return { pins: without(manual.pins), unpins: current ? [...without(manual.unpins), cwd] : without(manual.unpins) };
}

export function projectContextValue(pinned: boolean): "project-pinned" | "project-unpinned" {
  return pinned ? "project-pinned" : "project-unpinned";
}

/** The hover text of a project row: its path, then what the pin means for it. */
export function projectTooltip(state: PinState): string {
  if (state.pinned) {
    const why = state.pinSource === "manual" ? "pinned manually" : "inside the current workspace";
    return `${state.cwd}\nPinned above the sort order (${why}). Click the pin to unpin.`;
  }
  if (state.current) return `${state.cwd}\nInside the current workspace, unpinned`;
  return state.cwd;
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
 * The root rows of the Sessions tree: pinned projects first (sorted among themselves), then the
 * rest in the same sort.
 */
export function buildTreeModel(
  projects: readonly ProjectGroup[],
  workspaceFolderPaths: readonly string[],
  sortBy: SortBy,
  opts: PinOptions = {},
  manual: ManualPins = NO_MANUAL_PINS,
): TreeRow[] {
  const states = resolvePinned(projects, workspaceFolderPaths, manual, opts);
  const byCwd = new Map(states.map((st) => [st.project, st]));
  const row = (group: ProjectGroup): TreeRow => {
    const st = byCwd.get(group)!;
    const out: TreeRow = { kind: "project", group, current: st.current, pinned: st.pinned };
    if (st.pinSource) out.pinSource = st.pinSource;
    return out;
  };
  const pinned = states.filter((st) => st.pinned).map((st) => st.project);
  const rest = states.filter((st) => !st.pinned).map((st) => st.project);
  return [...sortProjects(pinned, sortBy).map(row), ...sortProjects(rest, sortBy).map(row)];
}
