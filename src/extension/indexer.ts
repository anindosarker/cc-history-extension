import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { getHideProjects, getProjectsDir } from "./config";
import { hiddenProjectMatcher } from "./hideProjects";
import { groupByProject, listSessionFiles, scanProjects, type ProjectGroup } from "./indexScan";

const CACHE_KEY = "ccHistory.index.v2";
const WATCH_DEBOUNCE_MS = 1000;

/** Owns the in-memory session index, its globalState cache, and the directory watcher. */
export class Indexer implements vscode.Disposable {
  private readonly byPath = new Map<string, SessionMeta>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly fileEmitter = new vscode.EventEmitter<string | undefined>();
  /** Raw watcher events: the absolute path that changed, or undefined when the platform gives no name. */
  readonly onDidChangeFile = this.fileEmitter.event;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private scanning: Promise<void> | undefined;
  private rescanRequested = false;
  private hidden = hiddenProjectMatcher(getHideProjects());

  constructor(private readonly context: vscode.ExtensionContext) {
    const cached = context.globalState.get<Record<string, SessionMeta>>(CACHE_KEY);
    if (cached) for (const [k, v] of Object.entries(cached)) this.byPath.set(k, v);
  }

  /** Sessions whose project is not hidden by ccHistory.tree.hideProjects. */
  get sessions(): SessionMeta[] {
    return [...this.byPath.values()].filter((s) => !this.hidden(s.cwd));
  }

  /** Every indexed session, hidden projects included. */
  get allSessions(): SessionMeta[] {
    return [...this.byPath.values()];
  }

  get projects(): ProjectGroup[] {
    return groupByProject(this.sessions);
  }

  /** Re-read ccHistory.tree.hideProjects and tell listeners the visible set may have changed. */
  reloadHiddenProjects(): void {
    this.hidden = hiddenProjectMatcher(getHideProjects());
    this.changeEmitter.fire();
  }

  findBySessionId(id: string): SessionMeta | undefined {
    for (const s of this.byPath.values()) if (s.sessionId === id) return s;
    return undefined;
  }

  /** Full scan; cached entries are reused when mtime and size match. */
  refresh(): Promise<void> {
    if (this.scanning) {
      this.rescanRequested = true;
      return this.scanning;
    }
    this.scanning = this.runScan().finally(() => {
      this.scanning = undefined;
      if (this.rescanRequested) {
        this.rescanRequested = false;
        void this.refresh();
      }
    });
    return this.scanning;
  }

  private async runScan(): Promise<void> {
    const dir = getProjectsDir();
    const files = await listSessionFiles(dir);
    const stale = files.filter((f) => {
      const c = this.byPath.get(f.filePath);
      return !c || c.mtime !== f.mtime || c.size !== f.size;
    }).length;
    const run = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
      let last = 0;
      const result = await scanProjects(dir, this.byPath, (done, total) => {
        if (!progress) return;
        progress.report({ message: `${done} / ${total}`, increment: ((done - last) / total) * 100 });
        last = done;
      });
      this.byPath.clear();
      for (const s of result.sessions) this.byPath.set(s.filePath, s);
      await this.context.globalState.update(CACHE_KEY, Object.fromEntries(this.byPath));
      this.changeEmitter.fire();
    };
    if (stale > 5) {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Indexing Claude Code sessions" },
        run,
      );
    } else {
      await run();
    }
  }

  /** Watch the projects dir and re-index after a quiet second. */
  startWatching(): void {
    this.stopWatching();
    const dir = getProjectsDir();
    if (!fs.existsSync(dir)) return;
    const onEvent = (_event: string, filename: string | Buffer | null) => {
      this.fileEmitter.fire(filename ? path.join(dir, String(filename)) : undefined);
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.refresh(), WATCH_DEBOUNCE_MS);
    };
    try {
      this.watcher = fs.watch(dir, { recursive: true }, onEvent);
    } catch {
      try {
        this.watcher = fs.watch(dir, onEvent);
      } catch {
        this.watcher = undefined;
      }
    }
    this.watcher?.on("error", () => this.stopWatching());
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  dispose(): void {
    this.stopWatching();
    if (this.debounce) clearTimeout(this.debounce);
    this.changeEmitter.dispose();
    this.fileEmitter.dispose();
  }
}
