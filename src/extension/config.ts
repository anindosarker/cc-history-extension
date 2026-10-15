import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { normalizeOpenAt, type OpenAt } from "../shared/openAt";
import { DEFAULT_HIDDEN_PROJECTS } from "./hideProjects";
import { normalizeSortBy, type SortBy } from "./treeModel";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getProjectsDir(): string {
  const raw = vscode.workspace.getConfiguration("ccHistory").get<string>("projectsDir") ?? "~/.claude/projects";
  return expandHome(raw.trim() || "~/.claude/projects");
}

/** Defaults to the "sessions" folder beside the projects folder. */
export function getSessionsDir(): string {
  const raw = vscode.workspace.getConfiguration("ccHistory").get<string>("sessionsDir") ?? "";
  const trimmed = raw.trim();
  if (trimmed) return expandHome(trimmed);
  return path.join(path.dirname(getProjectsDir()), "sessions");
}

export function getClaudeCommand(): string {
  const raw = vscode.workspace.getConfiguration("ccHistory").get<string>("claudeCommand") ?? "claude";
  return raw.trim() || "claude";
}

export function getOpenAt(): OpenAt {
  return normalizeOpenAt(vscode.workspace.getConfiguration("ccHistory").get<string>("openAt"));
}

export async function setOpenAt(value: OpenAt): Promise<void> {
  await vscode.workspace
    .getConfiguration("ccHistory")
    .update("openAt", normalizeOpenAt(value), vscode.ConfigurationTarget.Global);
}

export function getExportOptions(): { includeToolResults: boolean; includeThinking: boolean } {
  const cfg = vscode.workspace.getConfiguration("ccHistory.export");
  return {
    includeToolResults: cfg.get<boolean>("includeToolResults") ?? false,
    includeThinking: cfg.get<boolean>("includeThinking") ?? false,
  };
}

export function getShowStatus(): boolean {
  return vscode.workspace.getConfiguration("ccHistory.tree").get<boolean>("showStatus") ?? true;
}

/** Glob patterns for project folders hidden from the tree, the quick pick and the week summary. */
export function getHideProjects(): string[] {
  const raw = vscode.workspace.getConfiguration("ccHistory.tree").get<unknown>("hideProjects");
  if (!Array.isArray(raw)) return [...DEFAULT_HIDDEN_PROJECTS];
  return raw.filter((p): p is string => typeof p === "string");
}

/** Order of projects and sessions in the tree and in Find Session. */
export function getSortBy(): SortBy {
  return normalizeSortBy(vscode.workspace.getConfiguration("ccHistory.tree").get<string>("sortBy"));
}

export async function setSortBy(value: SortBy): Promise<void> {
  await vscode.workspace
    .getConfiguration("ccHistory.tree")
    .update("sortBy", normalizeSortBy(value), vscode.ConfigurationTarget.Global);
}
