import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../shared/protocol";
import type { FileChange, SessionData, SessionMeta, SubagentInfo, Turn } from "../shared/types";
import { getOpenAt, getSessionsDir, setOpenAt } from "./config";
import { extractFileChanges } from "./diff";
import type { DiffContentProvider } from "./diffProvider";
import { exportSession } from "./exportHost";
import { readLiveSessionIds } from "./liveStatus";
import { parseSessionFile, type ParsedSession } from "./parser";
import { resumeSession } from "./resume";
import { listSubagents, mergedFileChanges, parseSubagentFile } from "./subagents";

const CHUNK_THRESHOLD = 5000;
const CHUNK_SIZE = 1000;

/** Load and parse a full session for the viewer, export, or diff. */
export async function loadSessionData(meta: SessionMeta): Promise<SessionData> {
  const parsed = await parseSessionFile(meta.filePath);
  const merged: SessionMeta = {
    ...meta,
    gitBranch: parsed.gitBranch ?? meta.gitBranch,
    startedAt: parsed.startedAt ?? meta.startedAt,
    lastActivityAt: parsed.lastActivityAt ?? meta.lastActivityAt,
    messageCount: parsed.turns.filter((t) => t.kind === "user" || t.kind === "assistant").length,
  };
  return { meta: merged, turns: parsed.turns, files: extractFileChanges(parsed.turns) };
}

/** One webview panel per session; re-opening reveals the existing panel. */
export class SessionPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, SessionPanel>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly diffs: DiffContentProvider,
  ) {}

  open(meta: SessionMeta): void {
    const existing = this.panels.get(meta.sessionId);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = new SessionPanel(this.context, this.diffs, meta, () => this.panels.delete(meta.sessionId));
    this.panels.set(meta.sessionId, panel);
  }

  dispose(): void {
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }
}

class SessionPanel {
  private readonly panel: vscode.WebviewPanel;
  private data: SessionData | undefined;
  private agents: SubagentInfo[] = [];
  private readonly agentCache = new Map<string, Promise<ParsedSession>>();
  private mergedFiles: Promise<FileChange[]> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    private readonly diffs: DiffContentProvider,
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
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");
    this.panel.webview.html = this.html(webviewRoot);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: WebviewToHost) => void this.onMessage(m)),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  reveal(): void {
    this.panel.reveal();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.onClosed();
  }

  private post(msg: HostToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case "ready":
      case "loadSession":
        await this.load();
        return;
      case "openDiff": {
        const file = this.data?.files.find((f) => f.path === msg.path);
        if (file) await this.diffs.openDiff(this.meta, file, msg.hunkIndex);
        return;
      }
      case "revealFile":
        await revealFile(msg.path);
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
        await this.sendMergedFiles();
        return;
      case "resume":
        resumeSession(this.meta);
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

  private async load(): Promise<void> {
    this.post({ type: "loading" });
    this.agentCache.clear();
    this.mergedFiles = undefined;
    try {
      this.data = await loadSessionData(this.meta);
    } catch (err) {
      this.post({ type: "error", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.meta = this.data.meta;
    this.panel.title = this.meta.title;
    this.sendData(this.data.turns, this.data.files);
  }

  private async sendAgents(): Promise<void> {
    let parentAlive = false;
    try {
      parentAlive = (await readLiveSessionIds(getSessionsDir())).has(this.meta.sessionId);
    } catch {
      /* no sessions folder, treat the parent as ended */
    }
    this.agents = await listSubagents(this.meta, { parentAlive });
    this.post({ type: "agents", list: this.agents });
  }

  private parsedAgent(agentId: string): Promise<ParsedSession> | undefined {
    const info = this.agents.find((a) => a.agentId === agentId);
    if (!info) return undefined;
    let p = this.agentCache.get(agentId);
    if (!p) {
      p = parseSubagentFile(info);
      this.agentCache.set(agentId, p);
      p.catch(() => this.agentCache.delete(agentId));
    }
    return p;
  }

  private async sendAgent(agentId: string): Promise<void> {
    const pending = this.parsedAgent(agentId);
    if (!pending) {
      this.post({ type: "agentError", agentId, message: "This agent transcript is no longer listed." });
      return;
    }
    let parsed: ParsedSession;
    try {
      parsed = await pending;
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

  /** Files across main and every subagent; parsed once per panel load and reused by openDiff. */
  private async sendMergedFiles(): Promise<void> {
    if (!this.data) return;
    if (!this.mergedFiles) {
      const main = this.data;
      this.mergedFiles = (async () => {
        const agentTurns: Turn[][] = [];
        for (const a of this.agents) {
          try {
            agentTurns.push((await this.parsedAgent(a.agentId))!.turns);
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
    const info = this.agents.find((a) => a.agentId === agentId);
    const pending = this.parsedAgent(agentId);
    if (!info || !pending) return;
    const parsed = await pending;
    const data: SessionData = {
      meta: {
        ...this.meta,
        title: `${this.meta.title} - agent ${info.name}`,
        startedAt: parsed.startedAt ?? info.startedAt,
        lastActivityAt: parsed.lastActivityAt ?? info.endedAt,
        messageCount: parsed.turns.length,
      },
      turns: parsed.turns,
      files: [],
    };
    await exportSession(data, mode, `# Agent: ${info.name} (${info.description})`);
  }

  private sendData(turns: Turn[], files: FileChange[]): void {
    this.post({ type: "sessionStart", meta: this.meta, files, totalTurns: turns.length, openAt: getOpenAt() });
    if (turns.length <= CHUNK_THRESHOLD) {
      this.post({ type: "sessionTurns", turns, offset: 0, done: true });
      return;
    }
    for (let offset = 0; offset < turns.length; offset += CHUNK_SIZE) {
      const slice = turns.slice(offset, offset + CHUNK_SIZE);
      this.post({ type: "sessionTurns", turns: slice, offset, done: offset + CHUNK_SIZE >= turns.length });
    }
  }

  private html(webviewRoot: vscode.Uri): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "index.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "index.css"));
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>${escapeHtml(this.meta.title)}</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
  }
}

async function revealFile(p: string): Promise<void> {
  if (!fs.existsSync(p)) {
    void vscode.window.showWarningMessage(`File not found on disk: ${p}`);
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(p), { preview: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
