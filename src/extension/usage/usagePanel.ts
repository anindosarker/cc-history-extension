import * as vscode from "vscode";
import type { UsageHostToWebview, UsageWebviewToHost } from "../../shared/usage";
import type { Indexer } from "../indexer";
import { webviewHtml } from "../webviewHtml";
import type { UsagePoller } from "./usagePoller";
import { toUsageView } from "./usageView";
import { weekSummary } from "./weekSummary";

/** One "Usage" webview panel at a time; opening again reveals it. Pushes every poll result while open. */
export class UsagePanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly poller: UsagePoller,
    private readonly indexer: Indexer,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    const panel = vscode.window.createWebviewPanel("ccHistory.usage", "Usage", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewRoot],
    });
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, "media", "icon-light.svg"),
      dark: vscode.Uri.joinPath(this.context.extensionUri, "media", "icon-dark.svg"),
    };
    panel.webview.html = webviewHtml(panel.webview, webviewRoot, "Usage", "usage");
    this.panel = panel;
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: UsageWebviewToHost) => this.onMessage(m)),
      this.poller.onDidChange(() => this.push()),
      this.indexer.onDidChange(() => this.push()),
      panel.onDidDispose(() => this.closed()),
    );
    void this.poller.refresh();
  }

  private onMessage(m: UsageWebviewToHost): void {
    if (m.type === "usageRequest") this.push();
    else if (m.type === "usageRefresh") void this.poller.refresh();
  }

  private push(): void {
    if (!this.panel) return;
    const msg: UsageHostToWebview = {
      type: "usageSnapshot",
      view: toUsageView(this.poller.state, weekSummary(this.indexer.sessions, Date.now()), {
        warnAt: this.poller.currentSettings.warnAt,
        errorAt: this.poller.currentSettings.errorAt,
        colorBy: this.poller.currentSettings.colorBy,
      }),
    };
    void this.panel.webview.postMessage(msg);
  }

  private closed(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.panel = undefined;
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed();
  }
}
