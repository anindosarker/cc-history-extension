import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { DIFF_SCHEME, DiffContentProvider } from "./diffProvider";
import { getShowStatus, getSortBy, setSortBy } from "./config";
import { exportSession } from "./exportHost";
import { maybeShowFirstRunNotice } from "./firstRunHost";
import { copyPath, revealFolder } from "./folder";
import { Indexer } from "./indexer";
import { activityOf } from "./indexScan";
import { resumeSession } from "./resume";
import { loadSessionData, SessionPanelManager } from "./sessionPanel";
import { SessionStatusProvider } from "./statusProvider";
import { relativeTime } from "./time";
import { SORT_DETAIL, SORT_LABEL, SORT_MODES, sortSessions, type SortBy } from "./treeModel";
import { SessionNode, SessionTreeProvider, type TreeNode } from "./treeProvider";
import { UsageStatusBar } from "./usage/statusBar";
import { UsagePanelManager } from "./usage/usagePanel";
import { UsagePoller } from "./usage/usagePoller";

export function activate(context: vscode.ExtensionContext): void {
  const indexer = new Indexer(context);
  const status = new SessionStatusProvider(indexer);
  status.setEnabled(getShowStatus());
  const tree = new SessionTreeProvider(indexer, status, context.extensionUri);
  const diffs = new DiffContentProvider();
  const panels = new SessionPanelManager(context, diffs);
  const view = vscode.window.createTreeView("ccHistory.sessions", { treeDataProvider: tree, showCollapseAll: true });
  const version = String((context.extension.packageJSON as { version?: unknown }).version ?? "0.0.0");
  // Poll outcomes only: never a token or a header value.
  const usageLog = vscode.window.createOutputChannel("Claude Code History");
  const usage = new UsagePoller(version, (line) => usageLog.appendLine(line));
  const usageBar = new UsageStatusBar(usage);
  const usagePanel = new UsagePanelManager(context, usage, indexer);

  const metaFrom = (arg: unknown): SessionMeta | undefined => {
    if (arg instanceof SessionNode) return arg.meta;
    if (typeof arg === "string") return indexer.findBySessionId(arg);
    if (typeof arg === "object" && arg !== null && "filePath" in arg) return arg as SessionMeta;
    return undefined;
  };

  const withMeta = (fn: (meta: SessionMeta) => void | Thenable<void>) => async (arg?: unknown) => {
    const meta = metaFrom(arg) ?? (await pickSession(indexer));
    if (meta) await fn(meta);
  };

  context.subscriptions.push(
    indexer,
    status,
    tree,
    diffs,
    panels,
    view,
    usage,
    usageBar,
    usagePanel,
    usageLog,
    vscode.commands.registerCommand("ccHistory.showUsageLog", () => usageLog.show(true)),
    vscode.commands.registerCommand("ccHistory.refreshUsage", () => usage.refresh()),
    vscode.commands.registerCommand("ccHistory.openUsage", () => usagePanel.open()),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffs),
    vscode.window.registerFileDecorationProvider(status),
    view.onDidChangeVisibility((e) => status.setVisible(e.visible)),
    indexer.onDidChange(() => void status.refresh()),
    vscode.commands.registerCommand("ccHistory.refresh", () => indexer.refresh().then(() => tree.refresh())),
    vscode.commands.registerCommand("ccHistory.sortBy", async () => {
      const picked = await pickSortBy(getSortBy());
      if (picked && picked !== getSortBy()) await setSortBy(picked);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
    vscode.commands.registerCommand("ccHistory.findSession", async () => {
      const meta = await pickSession(indexer);
      if (meta) panels.open(meta);
    }),
    vscode.commands.registerCommand("ccHistory.openSession", withMeta((m) => panels.open(m))),
    vscode.commands.registerCommand("ccHistory.resume", withMeta((m) => resumeSession(m))),
    vscode.commands.registerCommand(
      "ccHistory.exportText",
      withMeta(async (m) => exportSession(await loadSessionData(m), "file")),
    ),
    vscode.commands.registerCommand(
      "ccHistory.copySessionId",
      withMeta(async (m) => {
        await vscode.env.clipboard.writeText(m.sessionId);
        void vscode.window.showInformationMessage(`Copied session id ${m.sessionId}`);
      }),
    ),
    vscode.commands.registerCommand(
      "ccHistory.revealJsonl",
      withMeta((m) => vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(m.filePath))),
    ),
    vscode.commands.registerCommand("ccHistory.revealProject", async (arg?: unknown) => {
      const cwd = projectCwdFrom(arg);
      if (cwd) await revealFolder(cwd);
    }),
    vscode.commands.registerCommand("ccHistory.copyProjectPath", async (arg?: unknown) => {
      const cwd = projectCwdFrom(arg);
      if (cwd) await copyPath(cwd);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ccHistory.projectsDir")) {
        indexer.startWatching();
        void indexer.refresh();
      }
      if (e.affectsConfiguration("ccHistory.projectsDir") || e.affectsConfiguration("ccHistory.sessionsDir")) {
        status.startWatching();
        void status.refresh();
      }
      if (e.affectsConfiguration("ccHistory.tree.showStatus")) status.setEnabled(getShowStatus());
      if (e.affectsConfiguration("ccHistory.tree.hideProjects")) {
        indexer.reloadHiddenProjects();
        tree.refresh();
      }
      if (e.affectsConfiguration("ccHistory.tree.sortBy")) tree.refresh();
    }),
  );

  usage.start();
  void maybeShowFirstRunNotice(context);
  void indexer.refresh().then(() => {
    indexer.startWatching();
    status.startWatching();
    status.setVisible(view.visible);
  });
}

export function deactivate(): void {}

interface SessionPick extends vscode.QuickPickItem {
  meta: SessionMeta;
}

interface SortPick extends vscode.QuickPickItem {
  mode: SortBy;
}

async function pickSortBy(current: SortBy): Promise<SortBy | undefined> {
  const items: SortPick[] = SORT_MODES.map((mode) => ({
    label: SORT_LABEL[mode],
    description: mode === current ? "current" : undefined,
    detail: SORT_DETAIL[mode],
    mode,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "Sort projects and sessions by" });
  return picked?.mode;
}

/** Sessions in the order the tree uses (ccHistory.tree.sortBy). */
async function pickSession(indexer: Indexer): Promise<SessionMeta | undefined> {
  const items: SessionPick[] = sortSessions(indexer.sessions, getSortBy())
    .map((meta) => ({
      label: meta.title,
      description: `${meta.projectName} · ${relativeTime(activityOf(meta))}`,
      detail: meta.firstPrompt ? truncate(meta.firstPrompt, 120) : undefined,
      meta,
    }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Search sessions by title, project or first prompt",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.meta;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

export type { TreeNode };

/** The working directory of a project tree node (or a plain cwd string) passed to a command. */
function projectCwdFrom(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (typeof arg === "object" && arg !== null && "group" in arg) {
    const group = (arg as { group?: { cwd?: unknown } }).group;
    if (typeof group?.cwd === "string") return group.cwd;
  }
  return undefined;
}
