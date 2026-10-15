import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { DIFF_SCHEME, DiffContentProvider } from "./diffProvider";
import { exportSession } from "./exportHost";
import { Indexer } from "./indexer";
import { activityOf } from "./indexScan";
import { resumeSession } from "./resume";
import { loadSessionData, SessionPanelManager } from "./sessionPanel";
import { relativeTime } from "./time";
import { SessionNode, SessionTreeProvider, type TreeNode } from "./treeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const indexer = new Indexer(context);
  const tree = new SessionTreeProvider(indexer);
  const diffs = new DiffContentProvider();
  const panels = new SessionPanelManager(context, diffs);
  const view = vscode.window.createTreeView("ccHistory.sessions", { treeDataProvider: tree, showCollapseAll: true });

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
    diffs,
    panels,
    view,
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffs),
    vscode.commands.registerCommand("ccHistory.refresh", () => indexer.refresh()),
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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ccHistory.projectsDir")) {
        indexer.startWatching();
        void indexer.refresh();
      }
    }),
  );

  void indexer.refresh().then(() => indexer.startWatching());
}

export function deactivate(): void {}

interface SessionPick extends vscode.QuickPickItem {
  meta: SessionMeta;
}

async function pickSession(indexer: Indexer): Promise<SessionMeta | undefined> {
  const items: SessionPick[] = indexer.sessions
    .sort((a, b) => activityOf(b) - activityOf(a))
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
