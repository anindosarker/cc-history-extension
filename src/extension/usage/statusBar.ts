import * as vscode from "vscode";
import { statusModel, type ColorLevel, type ColorMode } from "./format";
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
    const model = statusModel(state, settings, now);
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    // Needed for the "Show log" command link.
    md.isTrusted = true;
    this.item.text = model.text;
    this.applyColor(model.level, settings.colorMode);
    md.appendMarkdown(state.snapshot ? "**Claude Code usage**\n\n" : "**Claude Code usage unavailable**\n\n");
    for (const line of model.lines) md.appendMarkdown(`${escapeMd(line)}  \n`);
    md.appendMarkdown("\nClick to open the usage panel. [Show log](command:ccHistory.showUsageLog)");
    this.item.tooltip = md;
    this.item.show();
  }

  /** Background mode tints the whole item; text mode only the foreground; off mode neither. */
  private applyColor(level: ColorLevel | undefined, mode: ColorMode): void {
    this.item.color = undefined;
    this.item.backgroundColor = undefined;
    if (!level || mode === "off") return;
    if (mode === "background") {
      this.item.backgroundColor = new vscode.ThemeColor(`statusBarItem.${level}Background`);
    } else {
      this.item.color = new vscode.ThemeColor(level === "error" ? "charts.red" : "charts.yellow");
    }
  }

  dispose(): void {
    if (this.tick) clearInterval(this.tick);
    for (const d of this.disposables) d.dispose();
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|]/g, "\\$&");
}
