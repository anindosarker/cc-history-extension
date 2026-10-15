import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { agentTag } from "../shared/agents";
import type { HostToWebview, WebviewToHost } from "../shared/protocol";
import type { FileChange, SessionData, SessionMeta, SubagentInfo, Turn } from "../shared/types";
import { getOpenAt, getSessionsDir, setOpenAt } from "./config";
import { extractFileChanges } from "./diff";
import type { DiffContentProvider } from "./diffProvider";
import { exportSession } from "./exportHost";
import { resolveFilePath } from "./filePaths";
import { addFolderToWorkspace, openFolderInNewWindow, revealFolder } from "./folder";
import type { Indexer } from "./indexer";
import { computeStatus, readLiveSessionIds } from "./liveStatus";
import { parseSessionFile, SessionBuilder, type ParsedSession } from "./parser";
import { resumeSession } from "./resume";
import { listSubagents, mergedFileChanges, subagentsDir } from "./subagents";
import { TailReader } from "./tail";
import { webviewHtml } from "./webviewHtml";

const CHUNK_THRESHOLD = 5000;
const CHUNK_SIZE = 1000;
/** Quiet time after a watcher event before the panel reads what was appended. */
export const TAIL_DEBOUNCE_MS = 750;
/** How often the Live indicator is re-checked while the panel is visible. */
const LIVE_POLL_MS = 30_000;

/** Load and parse a full session for the viewer, export, or diff. */
export async function loadSessionData(meta: SessionMeta): Promise<SessionData> {
  return sessionDataFrom(meta, await parseSessionFile(meta.filePath));
}

function sessionDataFrom(meta: SessionMeta, parsed: ParsedSession): SessionData {
  return { meta: metaFrom(meta, parsed), turns: parsed.turns, files: extractFileChanges(parsed.turns) };
}

function metaFrom(meta: SessionMeta, parsed: ParsedSession): SessionMeta {
  return {
    ...meta,
    gitBranch: parsed.gitBranch ?? meta.gitBranch,
    startedAt: parsed.startedAt ?? meta.startedAt,
    lastActivityAt: parsed.lastActivityAt ?? meta.lastActivityAt,
    messageCount: parsed.turns.filter((t) => t.kind === "user" || t.kind === "assistant").length,
  };
}

/** One webview panel per session; re-opening reveals the existing panel. */
export class SessionPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, SessionPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly diffs: DiffContentProvider,
    private readonly indexer: Indexer,
  ) {}

  open(meta: SessionMeta): void {
    const existing = this.panels.get(meta.sessionId);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = new SessionPanel(this.context, this.diffs, this.indexer, meta, () => this.panels.delete(meta.sessionId));
    this.panels.set(meta.sessionId, panel);
  }

  dispose(): void {
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }
}

/** A transcript kept open for appends: the builder that parsed it so far and the reader that feeds it. */
interface LiveSource {
  builder: SessionBuilder;
  tail: TailReader;
}

interface AgentSource extends LiveSource {
  info: SubagentInfo;
  parsed: Promise<ParsedSession>;
}

class SessionPanel {
  private readonly panel: vscode.WebviewPanel;
  private data: SessionData | undefined;
  private source: LiveSource | undefined;
  private agents: SubagentInfo[] = [];
  private readonly agentCache = new Map<string, AgentSource>();
  private mergedFiles: Promise<FileChange[]> | undefined;
  /** Whether the viewer asked for merged files at least once, so appends keep them fresh. */
  private filesMerged = false;
  private readonly disposables: vscode.Disposable[] = [];
  private tailTimer: NodeJS.Timeout | undefined;
  private tailing = false;
  private tailAgain = false;
  private liveTimer: NodeJS.Timeout | undefined;
  private live = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly diffs: DiffContentProvider,
    indexer: Indexer,
    private meta: SessionMeta,
    private readonly onClosed: () => void,
  ) {
    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel(
      "ccHistory.session",
      meta.title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
        enableFindWidget: false,
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "session-claude.svg");
    this.panel.webview.html = webviewHtml(this.panel.webview, webviewRoot, meta.title, "session");
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.onMessage(m)),
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.onDidChangeViewState(() => this.setLivePolling(this.panel.visible)),
      indexer.onDidChangeFile((p) => this.onFileEvent(p)),
    );
    this.setLivePolling(this.panel.visible);
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    if (this.tailTimer) clearTimeout(this.tailTimer);
    this.tailTimer = undefined;
    this.setLivePolling(false);
    this.onClosed();
  }

  private post(msg: HostToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
      case "loadSession":
        await this.load(false);
        return;
      case "reloadSession":
        await this.load(this.data !== undefined);
        return;
      case "openDiff": {
        const file = this.data?.files.find((f) => f.path === msg.path);
        if (file) await this.diffs.openDiff(this.meta, file, msg.hunkIndex);
        return;
      }
      case "revealFile":
        await revealFile(resolveFilePath(msg.path, this.meta.cwd), msg.path, msg.line, msg.column);
        return;
      case "revealJsonl":
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(this.meta.filePath));
        return;
      case "export":
        if (msg.agentId) await this.exportAgent(msg.agentId, msg.mode);
        else if (this.data) await exportSession(this.data, msg.mode);
        return;
      case "listAgents":
        await this.sendAgents();
        return;
      case "loadAgent":
        await this.sendAgent(msg.agentId);
        return;
      case "loadFiles":
        this.filesMerged = true;
        await this.sendMergedFiles();
        return;
      case "resume":
        resumeSession(this.meta);
        return;
      case "openUsage":
        await vscode.commands.executeCommand("ccHistory.openUsage");
        return;
      case "openFolder":
        await revealFolder(this.meta.cwd);
        return;
      case "folderAction":
        if (msg.action === "newWindow") await openFolderInNewWindow(this.meta.cwd);
        else addFolderToWorkspace(this.meta.cwd);
        return;
      case "setOpenAt":
        await setOpenAt(msg.value);
        this.post({ type: "openAt", value: getOpenAt() });
        return;
      case "copyText":
        await vscode.env.clipboard.writeText(msg.text);
        return;
    }
  }

  /** Full parse. A reload keeps the viewer mounted: no loading screen, the turns are swapped in place. */
  private async load(reload: boolean): Promise<void> {
    if (!reload) this.post({ type: "loading" });
    this.agentCache.clear();
    this.mergedFiles = undefined;
    try {
      const builder = new SessionBuilder();
      const tail = new TailReader(this.meta.filePath);
      const read = await tail.read();
      for (const line of read?.lines ?? []) builder.push(line);
      builder.takeAppend();
      this.source = { builder, tail };
      this.data = sessionDataFrom(this.meta, builder.finish());
    } catch (err) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.meta = this.data.meta;
    this.panel.title = this.meta.title;
    this.sendData(this.data.turns, this.data.files, reload);
    void this.updateLive();
  }

  // ---- live tail ----

  /** A watcher event somewhere under the projects folder; only this session's files matter. */
  private onFileEvent(changed: string | undefined): void {
    if (changed !== undefined && !this.concernsSession(changed)) return;
    if (this.tailTimer) clearTimeout(this.tailTimer);
    this.tailTimer = setTimeout(() => {
      this.tailTimer = undefined;
      void this.tailTick();
    }, TAIL_DEBOUNCE_MS);
  }

  private concernsSession(changed: string): boolean {
    if (changed === this.meta.filePath) return true;
    const agentsDir = subagentsDir(this.meta);
    if (changed.startsWith(agentsDir + path.sep) || changed === agentsDir) return true;
    // A folder-level event (no file name on some platforms) for one of our folders.
    if (changed.endsWith(".jsonl")) return false;
    return this.meta.filePath.startsWith(changed + path.sep) || agentsDir.startsWith(changed + path.sep);
  }

  /** Read what was appended to the main and the loaded agent transcripts, then refresh what depends on it. */
  private async tailTick(): Promise<void> {
    if (!this.source || !this.data) return;
    if (this.tailing) {
      this.tailAgain = true;
      return;
    }
    this.tailing = true;
    try {
      const mainChanged = await this.tailMain();
      let agentChanged = false;
      for (const src of [...this.agentCache.values()]) agentChanged = (await this.tailAgent(src)) || agentChanged;
      await this.sendAgents();
      if ((mainChanged || agentChanged) && this.filesMerged) {
        this.mergedFiles = undefined;
        await this.sendMergedFiles();
      }
      await this.updateLive();
    } finally {
      this.tailing = false;
      if (this.tailAgain) {
        this.tailAgain = false;
        void this.tailTick();
      }
    }
  }

  /** True when the main transcript gained or changed turns. A truncated or rewritten file reloads in full. */
  private async tailMain(): Promise<boolean> {
    if (!this.source || !this.data) return false;
    let read;
    try {
      read = await this.source.tail.read();
    } catch {
      return false;
    }
    if (!read) return false;
    if (read.reset) {
      await this.load(true);
      return true;
    }
    for (const line of read.lines) this.source.builder.push(line);
    const parsed = this.source.builder.finish();
    const append = this.source.builder.takeAppend();
    this.meta = metaFrom(this.meta, parsed);
    this.data.meta = this.meta;
    this.panel.title = this.meta.title;
    if (!append) return false;
    this.data.files = extractFileChanges(parsed.turns);
    this.post({
      type: "sessionAppend",
      offset: append.offset,
      turns: append.turns,
      meta: this.meta,
      files: this.filesMerged ? undefined : this.data.files,
    });
    return true;
  }

  private async tailAgent(src: AgentSource): Promise<boolean> {
    let read;
    try {
      await src.parsed;
      read = await src.tail.read();
    } catch {
      return false;
    }
    if (!read) return false;
    if (read.reset) {
      this.agentCache.delete(src.info.agentId);
      await this.sendAgent(src.info.agentId);
      return true;
    }
    for (const line of read.lines) src.builder.push(line);
    const append = src.builder.takeAppend();
    if (!append) return false;
    const parsed = src.builder.finish();
    this.post({ type: "agentAppend", agentId: src.info.agentId, offset: append.offset, turns: append.turns, tokens: parsed.tokens });
    return true;
  }

  // ---- live indicator ----

  private setLivePolling(on: boolean): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
    if (!on) return;
    void this.updateLive();
    this.liveTimer = setInterval(() => void this.updateLive(), LIVE_POLL_MS);
  }

  /** The tree's "running" rule: a live Claude process owns the session and wrote to it in the last two minutes. */
  private async updateLive(): Promise<void> {
    let live = false;
    try {
      const alive = (await readLiveSessionIds(getSessionsDir())).has(this.meta.sessionId);
      if (alive) {
        const mtime = (await fs.promises.stat(this.meta.filePath)).mtimeMs;
        live = computeStatus({ alive, mtime, now: Date.now() }) === "running";
      }
    } catch {
      live = false;
    }
    if (live === this.live) return;
    this.live = live;
    this.post({ type: "live", live });
  }

  // ---- agents ----

  private async sendAgents(): Promise<void> {
    let parentAlive = false;
    try {
      parentAlive = (await readLiveSessionIds(getSessionsDir())).has(this.meta.sessionId);
    } catch {
      /* no sessions folder, treat the parent as ended */
    }
    this.agents = await listSubagents(this.meta, { parentAlive, mainTurns: this.data?.turns });
    for (const src of this.agentCache.values()) {
      const fresh = this.agents.find((a) => a.agentId === src.info.agentId);
      if (fresh) src.info = fresh;
    }
    this.post({ type: "agents", list: this.agents });
  }

  private agentSource(agentId: string): AgentSource | undefined {
    const info = this.agents.find((a) => a.agentId === agentId);
    if (!info) return undefined;
    let src = this.agentCache.get(agentId);
    if (!src) {
      const builder = new SessionBuilder({ sidechain: true, agent: agentTag(info) });
      const tail = new TailReader(info.filePath);
      const parsed = (async () => {
        const read = await tail.read();
        for (const line of read?.lines ?? []) builder.push(line);
        builder.takeAppend();
        return builder.finish();
      })();
      src = { info, builder, tail, parsed };
      this.agentCache.set(agentId, src);
      parsed.catch(() => this.agentCache.delete(agentId));
    }
    return src;
  }

  private async sendAgent(agentId: string): Promise<void> {
    const src = this.agentSource(agentId);
    if (!src) {
      this.post({ type: "agentError", agentId, message: "This agent transcript is no longer listed." });
      return;
    }
    let parsed: ParsedSession;
    try {
      parsed = await src.parsed;
    } catch (err) {
      this.post({ type: "agentError", agentId, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    const turns = parsed.turns;
    this.post({ type: "agentStart", agentId, totalTurns: turns.length, tokens: parsed.tokens });
    if (turns.length <= CHUNK_THRESHOLD) {
      this.post({ type: "agentTurns", agentId, turns, offset: 0, done: true });
      return;
    }
    for (let offset = 0; offset < turns.length; offset += CHUNK_SIZE) {
      const slice = turns.slice(offset, offset + CHUNK_SIZE);
      this.post({ type: "agentTurns", agentId, turns: slice, offset, done: offset + CHUNK_SIZE >= turns.length });
    }
  }

  /** Files across main and every subagent; computed once per load (and again after an append) and reused by openDiff. */
  private async sendMergedFiles(): Promise<void> {
    if (!this.data) return;
    if (!this.mergedFiles) {
      const main = this.data;
      this.mergedFiles = (async () => {
        const agentTurns: Turn[][] = [];
        for (const a of this.agents) {
          try {
            agentTurns.push((await this.agentSource(a.agentId)!.parsed).turns);
          } catch {
            /* skip transcripts that fail to parse */
          }
        }
        const files = mergedFileChanges(main.turns, agentTurns);
        main.files = files;
        return files;
      })();
      this.mergedFiles.catch(() => (this.mergedFiles = undefined));
    }
    try {
      this.post({ type: "files", files: await this.mergedFiles });
    } catch (err) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  private async exportAgent(agentId: string, mode: "file" | "clipboard"): Promise<void> {
    const src = this.agentSource(agentId);
    if (!src) return;
    const parsed = await src.parsed;
    const info = src.info;
    const data: SessionData = {
      meta: {
        ...this.meta,
        title: `${this.meta.title} - agent ${agentTag(info)}`,
        startedAt: parsed.startedAt ?? info.startedAt,
        lastActivityAt: parsed.lastActivityAt ?? info.endedAt,
        messageCount: parsed.turns.filter((t) => t.kind === "user" || t.kind === "assistant").length,
      },
      turns: parsed.turns,
      files: [],
    };
    await exportSession(data, mode, `# Agent: ${agentTag(info)} (${info.description})`);
  }

  private sendData(turns: Turn[], files: FileChange[], reload: boolean): void {
    this.post({ type: "sessionStart", meta: this.meta, files, totalTurns: turns.length, openAt: getOpenAt(), reload });
    if (turns.length <= CHUNK_THRESHOLD) {
      this.post({ type: "sessionTurns", turns, offset: 0, done: true });
      return;
    }
    for (let offset = 0; offset < turns.length; offset += CHUNK_SIZE) {
      const slice = turns.slice(offset, offset + CHUNK_SIZE);
      this.post({ type: "sessionTurns", turns: slice, offset, done: offset + CHUNK_SIZE >= turns.length });
    }
  }
}

async function revealFile(p: string, shown: string, line?: number, column?: number): Promise<void> {
  if (!fs.existsSync(p)) {
    void vscode.window.showInformationMessage(`File not found: ${shown}`);
    return;
  }
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(p), { preview: true });
  if (line === undefined) return;
  const l = Math.max(0, Math.min(line - 1, editor.document.lineCount - 1));
  const c = Math.max(0, (column ?? 1) - 1);
  const pos = new vscode.Position(l, c);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
