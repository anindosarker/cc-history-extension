import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { getSortBy } from "./config";
import type { Indexer } from "./indexer";
import { activityMinute, activityOf, type ProjectGroup } from "./indexScan";
import { STATUS_LABEL } from "./liveStatus";
import { projectUri, statusUri, type SessionStatusProvider } from "./statusProvider";
import { relativeTime } from "./time";
import { buildTreeModel, DIVIDER_LABEL, pinCurrentProjects, sortSessions, type TreeRow } from "./treeModel";
import { sessionTooltipLines } from "./treeTooltip";

const REFRESH_DEBOUNCE_MS = 3000;

export class ProjectNode {
  constructor(
    readonly group: ProjectGroup,
    readonly current = false,
  ) {}
}

export class SessionNode {
  constructor(readonly meta: SessionMeta) {}
}

/** The "Other projects" row between the current workspace's projects and the rest. */
export class DividerNode {}

export type TreeNode = ProjectNode | SessionNode | DividerNode;

/** Paths of the folders open in this window, as the tree compares them against project cwds. */
export function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sessionIcon: vscode.Uri;
  private signature = "";
  private pending: NodeJS.Timeout | undefined;

  constructor(
    private readonly indexer: Indexer,
    private readonly status: SessionStatusProvider,
    extensionUri: vscode.Uri,
  ) {
    this.sessionIcon = vscode.Uri.joinPath(extensionUri, "media", "session-claude.svg");
    indexer.onDidChange(() => this.scheduleRefresh());
    status.onDidChange(() => this.scheduleRefresh());
  }

  /** Immediate, unconditional refresh (manual Refresh command, setting or workspace folder change). */
  refresh(): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = undefined;
    this.signature = this.computeSignature();
    this.emitter.fire(undefined);
  }

  /** Coalesce bursts of index and status events, and skip the event when nothing visible changed. */
  private scheduleRefresh(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      const next = this.computeSignature();
      if (next === this.signature) return;
      this.signature = next;
      this.emitter.fire(undefined);
    }, REFRESH_DEBOUNCE_MS);
  }

  private computeSignature(): string {
    const projects = this.indexer.projects;
    const pinned = pinCurrentProjects(projects, workspaceFolderPaths())
      .current.map((g) => g.cwd)
      .join(",");
    const body = projects
      .map(
        (g) =>
          g.cwd +
          "{" +
          g.sessions
            .map((s) => `${s.sessionId}|${s.title}|${activityMinute(s)}|${this.status.statusOf(s.sessionId) ?? ""}`)
            .join(",") +
          "}",
      )
      .join(";");
    return `${getSortBy()}#${pinned}#${body}`;
  }

  dispose(): void {
    if (this.pending) clearTimeout(this.pending);
    this.emitter.dispose();
  }

  /** The root rows as the tree shows them: current projects, divider, other projects. */
  rootRows(): TreeRow[] {
    return buildTreeModel(this.indexer.projects, workspaceFolderPaths(), getSortBy());
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const rows = this.rootRows();
      void vscode.commands.executeCommand("setContext", "ccHistory.empty", rows.length === 0);
      return rows.map((r) => (r.kind === "divider" ? new DividerNode() : new ProjectNode(r.group, r.current)));
    }
    if (element instanceof ProjectNode) {
      return sortSessions(element.group.sessions, getSortBy()).map((s) => new SessionNode(s));
    }
    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof DividerNode) {
      const item = new vscode.TreeItem(DIVIDER_LABEL, vscode.TreeItemCollapsibleState.None);
      item.id = "divider";
      item.tooltip = "Projects outside the current workspace";
      item.iconPath = new vscode.ThemeIcon("dash");
      item.contextValue = "divider";
      return item;
    }
    if (element instanceof ProjectNode) {
      const g = element.group;
      const item = new vscode.TreeItem(g.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `project:${g.cwd}`;
      item.description = `${g.sessions.length} session${g.sessions.length === 1 ? "" : "s"}`;
      item.tooltip = element.current ? `${g.cwd}\nIn the current workspace` : g.cwd;
      item.iconPath = new vscode.ThemeIcon("folder");
      item.contextValue = "project";
      // Only current projects carry the resource uri, so only they get the "cur" badge.
      if (element.current) item.resourceUri = projectUri(g.cwd);
      return item;
    }
    const m = element.meta;
    const item = new vscode.TreeItem(m.title, vscode.TreeItemCollapsibleState.None);
    item.id = `session:${m.filePath}`;
    item.description = relativeTime(activityOf(m));
    const status = this.status.statusOf(m.sessionId);
    item.tooltip = sessionTooltip(m, status ? STATUS_LABEL[status] : undefined);
    item.iconPath = { light: this.sessionIcon, dark: this.sessionIcon };
    item.resourceUri = statusUri(m.sessionId);
    item.contextValue = "session";
    item.command = { command: "ccHistory.openSession", title: "Open", arguments: [element] };
    return item;
  }
}

function sessionTooltip(m: SessionMeta, status: string | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(sessionTooltipLines(m, status).join("\n\n"));
  return md;
}
