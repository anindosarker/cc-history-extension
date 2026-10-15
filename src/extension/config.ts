import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { normalizeOpenAt, type OpenAt } from "../shared/openAt";

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getProjectsDir(): string {
  const raw = vscode.workspace.getConfiguration("ccHistory").get<string>("projectsDir") ?? "~/.claude/projects";
  return expandHome(raw.trim() || "~/.claude/projects");
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
