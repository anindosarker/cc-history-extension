import * as fs from "node:fs";
import * as vscode from "vscode";
import { getSessionsDir } from "./config";
import type { Indexer } from "./indexer";
import { computeStatus, readLiveSessionIds, STATUS_LABEL, type LiveStatus } from "./liveStatus";

export const STATUS_SCHEME = "cc-history-session";
const POLL_MS = 15_000;
const WATCH_DEBOUNCE_MS = 500;

const STATUS_COLOR: Record<LiveStatus, string> = {
  running: "charts.green",
  open: "charts.blue",
  ended: "charts.red",
};

export function statusUri(sessionId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: STATUS_SCHEME, path: `/${sessionId}` });
}

/** Tracks which sessions are live and exposes the result as tree item decorations. */
export class SessionStatusProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly statuses = new Map<string, LiveStatus>();
  private readonly decoEmitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.decoEmitter.event;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when any status changed, so the tree can refresh tooltips. */
  readonly onDidChange = this.changeEmitter.event;
  private timer: NodeJS.Timeout | undefined;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private refreshing = false;
  private again = false;
  private enabled = true;
  private visible = false;

  constructor(private readonly indexer: Indexer) {}

  statusOf(sessionId: string): LiveStatus | undefined {
    return this.statuses.get(sessionId);
  }

  /**
   * Turn live status on or off (ccHistory.tree.showStatus). Off stops the poll and the
   * watcher and clears every decoration; on restarts both for the current visibility.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) {
      this.startWatching();
      this.setVisible(this.visible);
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    this.stopWatching();
    this.clearStatuses();
  }

  private clearStatuses(): void {
    if (this.statuses.size === 0) return;
    const cleared = [...this.statuses.keys()].map(statusUri);
    this.statuses.clear();
    this.decoEmitter.fire(cleared);
    this.changeEmitter.fire();
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== STATUS_SCHEME) return undefined;
    const status = this.statuses.get(uri.path.slice(1));
    if (!status) return undefined;
    const deco = new vscode.FileDecoration("●", STATUS_LABEL[status], new vscode.ThemeColor(STATUS_COLOR[status]));
    deco.propagate = false;
    return deco;
  }

  /** Poll while the view is visible; stop when hidden. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!visible || !this.enabled) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  startWatching(): void {
    this.stopWatching();
    if (!this.enabled) return;
    const dir = getSessionsDir();
    if (!fs.existsSync(dir)) return;
    try {
      this.watcher = fs.watch(dir, () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
      });
      this.watcher.on("error", () => this.stopWatching());
    } catch {
      this.watcher = undefined;
    }
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  async refresh(): Promise<void> {
    if (!this.enabled) return;
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      await this.recompute();
    } finally {
      this.refreshing = false;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  private async recompute(): Promise<void> {
    const live = await readLiveSessionIds(getSessionsDir());
    const now = Date.now();
    const next = new Map<string, LiveStatus>();
    await Promise.all(
      this.indexer.sessions.map(async (s) => {
        let mtime = s.mtime;
        try {
          mtime = (await fs.promises.stat(s.filePath)).mtimeMs;
        } catch {
          /* file gone, fall back to the indexed mtime */
        }
        const status = computeStatus({ alive: live.has(s.sessionId), mtime, now });
        if (status) next.set(s.sessionId, status);
      }),
    );
    const changed: vscode.Uri[] = [];
    for (const id of new Set([...this.statuses.keys(), ...next.keys()])) {
      if (this.statuses.get(id) !== next.get(id)) changed.push(statusUri(id));
    }
    if (changed.length === 0) return;
    this.statuses.clear();
    for (const [k, v] of next) this.statuses.set(k, v);
    this.decoEmitter.fire(changed);
    this.changeEmitter.fire();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.stopWatching();
    this.decoEmitter.dispose();
    this.changeEmitter.dispose();
  }
}
