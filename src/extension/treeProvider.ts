import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import type { Indexer } from "./indexer";
import { activityMinute, activityOf, type ProjectGroup } from "./indexScan";
import { STATUS_LABEL } from "./liveStatus";
import { statusUri, type SessionStatusProvider } from "./statusProvider";
import { formatDateTime, relativeTime } from "./time";

/** Sessions with activity this recent get the icon variant with a green dot. */

const REFRESH_DEBOUNCE_MS = 3000;

export class ProjectNode {
  constructor(readonly group: ProjectGroup) {}
}

export class SessionNode {
  constructor(readonly meta: SessionMeta) {}
}

export type TreeNode = ProjectNode | SessionNode;

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

  /** Immediate, unconditional refresh (manual Refresh command). */
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
    return this.indexer.projects
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
  }

  dispose(): void {
    if (this.pending) clearTimeout(this.pending);
    this.emitter.dispose();
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const groups = this.indexer.projects;
      void vscode.commands.executeCommand("setContext", "ccHistory.empty", groups.length === 0);
      return groups.map((g) => new ProjectNode(g));
    }
    if (element instanceof ProjectNode) return element.group.sessions.map((s) => new SessionNode(s));
    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element instanceof ProjectNode) {
      const g = element.group;
      const item = new vscode.TreeItem(g.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `project:${g.cwd}`;
      item.description = `${g.sessions.length} session${g.sessions.length === 1 ? "" : "s"}`;
      item.tooltip = g.cwd;
      item.iconPath = new vscode.ThemeIcon("folder");
      item.contextValue = "project";
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
  md.appendMarkdown(`**${escapeMd(m.title)}**\n\n`);
  if (status) md.appendMarkdown(`Status: ${status}\n\n`);
  if (m.startedAt) md.appendMarkdown(`Started: ${formatDateTime(m.startedAt)}\n\n`);
  if (m.gitBranch) md.appendMarkdown(`Branch: ${escapeMd(m.gitBranch)}\n\n`);
  md.appendMarkdown(`Messages: ${m.messageCount}\n\n`);
  md.appendMarkdown(`Session: \`${m.sessionId}\``);
  return md;
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|-]/g, "\\$&");
}
