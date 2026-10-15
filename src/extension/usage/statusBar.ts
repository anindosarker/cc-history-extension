import * as vscode from "vscode";
import { ERROR_REASON_TEXT, formatAgo, severity, STATUS_ERROR_TEXT, statusBarText, tooltipLines } from "./format";
import type { UsagePoller, UsageState } from "./usagePoller";

const TOOLTIP_TICK_MS = 15_000;

/** Right-aligned status bar item showing the current rate-limit usage; click opens the usage panel. */
export class UsageStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private tick: NodeJS.Timeout | undefined;
  private last: UsageState = { refreshing: false };

  constructor(private readonly poller: UsagePoller) {
    this.item = vscode.window.createStatusBarItem("ccHistory.usage", vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Claude Code usage";
    this.item.command = "ccHistory.openUsage";
    this.disposables.push(this.item, poller.onDidChange((s) => this.render(s)));
    // Keep "Updated Ns ago" honest between polls.
    this.tick = setInterval(() => this.render(this.last), TOOLTIP_TICK_MS);
    this.render(poller.state);
  }

  private render(state: UsageState): void {
    this.last = state;
    const settings = this.poller.currentSettings;
    if (!settings.enabled || !settings.showInStatusBar) {
      this.item.hide();
      return;
    }
    const now = Date.now();
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    if (state.error || !state.snapshot) {
      this.item.text = state.refreshing && !state.error ? "$(sparkle) usage …" : STATUS_ERROR_TEXT;
      this.item.backgroundColor = undefined;
      if (state.error) {
        md.appendMarkdown(`**Claude Code usage unavailable**\n\n${ERROR_REASON_TEXT[state.error.reason]}\n\n`);
        if (state.error.reason === "http" || state.error.reason === "network") {
          md.appendMarkdown(`${escapeMd(state.error.message)}\n\n`);
        }
        md.appendMarkdown(`Last attempt ${formatAgo(now - state.error.at)}.`);
        if (state.snapshot) {
          md.appendMarkdown("\n\nLast good reading:\n\n");
          for (const line of tooltipLines(state.snapshot, { now, plan: state.plan })) md.appendMarkdown(`${escapeMd(line)}  \n`);
        }
      } else {
        md.appendMarkdown("Fetching Claude Code usage…");
      }
      this.item.tooltip = md;
      this.item.show();
      return;
    }
    const snap = state.snapshot;
    this.item.text = statusBarText(snap);
    const sev = severity(snap);
    this.item.backgroundColor = sev ? new vscode.ThemeColor(`statusBarItem.${sev}Background`) : undefined;
    md.appendMarkdown("**Claude Code usage**\n\n");
    for (const line of tooltipLines(snap, { now, plan: state.plan })) md.appendMarkdown(`${escapeMd(line)}  \n`);
    md.appendMarkdown("\nClick to open the usage panel.");
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    if (this.tick) clearInterval(this.tick);
    for (const d of this.disposables) d.dispose();
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|]/g, "\\$&");
}
