import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionMeta } from "../shared/types";
import { resolveTitle } from "../shared/title";
import { forEachLine, tryParseJson } from "./jsonl";
import { decodeProjectDirName } from "./projectPath";
import {
  asRecord,
  blocksOf,
  classifyRecord,
  extractCommandName,
  parseTimestamp,
  userPlainText,
  type RawBlock,
} from "./records";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Cheap prefilter so the index pass skips JSON.parse for records it never needs. */
const INTERESTING = ['"type":"user"', '"type":"assistant"', '"type":"custom-title"', '"type":"ai-title"'];

/** Collects session metadata from raw lines without building display turns. */
export class IndexBuilder {
  private sessionId?: string;
  private cwd?: string;
  private customTitle?: string;
  private aiTitle?: string;
  private firstPrompt?: string;
  private firstCommand?: string;
  private gitBranch?: string;
  private startedAt?: number;
  private lastActivityAt?: number;
  private messageCount = 0;
  private lastAssistantMsgId?: string;
  private readonly editedFiles = new Set<string>();

  push(line: string): void {
    if (!INTERESTING.some((needle) => line.includes(needle))) return;
    const r = asRecord(tryParseJson(line));
    if (!r) return;
    if (r.type === "custom-title" && typeof r.customTitle === "string") {
      this.customTitle = r.customTitle;
      return;
    }
    if (r.type === "ai-title" && typeof r.aiTitle === "string") {
      this.aiTitle = r.aiTitle;
      return;
    }
    if (r.type !== "user" && r.type !== "assistant") return;
    if (!this.sessionId && typeof r.sessionId === "string") this.sessionId = r.sessionId;
    if (!this.cwd && typeof r.cwd === "string" && r.cwd) this.cwd = r.cwd;
    if (typeof r.gitBranch === "string" && r.gitBranch) this.gitBranch = r.gitBranch;

    const kind = classifyRecord(r);
    if (kind === "system" && !this.firstCommand) {
      this.firstCommand = extractCommandName(r.message?.content);
    }
    if (kind === "skip" || kind === "toolResultOnly") return;
    const ts = parseTimestamp(r.timestamp);
    if (ts) {
      if (this.startedAt === undefined) this.startedAt = ts;
      this.lastActivityAt = Math.max(this.lastActivityAt ?? 0, ts);
    }
    // Injected agent and system records are displayed but are neither prompts nor counted messages.
    if (kind === "agent" || kind === "system") {
      this.lastAssistantMsgId = undefined;
      return;
    }
    if (kind === "user") {
      this.lastAssistantMsgId = undefined;
      this.messageCount++;
      if (!this.firstPrompt) {
        const text = userPlainText(r.message?.content);
        if (text) this.firstPrompt = text;
      }
      return;
    }
    const msgId = r.message?.id;
    if (!msgId || msgId !== this.lastAssistantMsgId) this.messageCount++;
    this.lastAssistantMsgId = msgId;
    for (const b of blocksOf(r.message?.content) as RawBlock[]) {
      if (b.type !== "tool_use" || typeof b.name !== "string" || !EDIT_TOOLS.has(b.name)) continue;
      const input = b.input as Record<string, unknown> | undefined;
      const p = input?.file_path ?? input?.notebook_path;
      if (typeof p === "string") this.editedFiles.add(p);
    }
  }

  finish(filePath: string, stat: { mtimeMs: number; size: number }): SessionMeta {
    const sessionId = this.sessionId ?? path.basename(filePath, ".jsonl");
    const cwd = this.cwd ?? decodeProjectDirName(path.basename(path.dirname(filePath)));
    const { title, source } = resolveTitle({
      customTitle: this.customTitle,
      aiTitle: this.aiTitle,
      firstPrompt: this.firstPrompt,
      firstCommand: this.firstCommand,
      startedAt: this.startedAt,
      sessionId,
    });
    const meta: SessionMeta = {
      sessionId,
      filePath,
      cwd,
      projectName: projectNameOf(cwd),
      title,
      titleSource: source,
      messageCount: this.messageCount,
      filesChanged: this.editedFiles.size,
      mtime: stat.mtimeMs,
      size: stat.size,
    };
    if (this.firstPrompt) meta.firstPrompt = this.firstPrompt.replace(/\s+/g, " ").slice(0, 300);
    if (this.startedAt !== undefined) meta.startedAt = this.startedAt;
    if (this.lastActivityAt !== undefined) meta.lastActivityAt = this.lastActivityAt;
    if (this.gitBranch) meta.gitBranch = this.gitBranch;
    return meta;
  }
}

export function projectNameOf(cwd: string): string {
  const base = path.basename(cwd);
  return base || cwd;
}

export async function indexFile(filePath: string): Promise<SessionMeta> {
  const stat = await fs.promises.stat(filePath);
  const b = new IndexBuilder();
  await forEachLine(filePath, (line) => b.push(line));
  return b.finish(filePath, stat);
}

export function indexText(text: string, filePath: string): SessionMeta {
  const b = new IndexBuilder();
  for (const line of text.split(/\r?\n/)) if (line) b.push(line);
  return b.finish(filePath, { mtimeMs: 0, size: text.length });
}

export interface SessionFileStat {
  filePath: string;
  mtime: number;
  size: number;
}

/** Top-level session logs only; subagent and memory folders are ignored. */
export async function listSessionFiles(projectsDir: string): Promise<SessionFileStat[]> {
  const out: SessionFileStat[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsDir, d.name);
    let files: fs.Dirent[];
    try {
      files = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, f.name);
      try {
        const st = await fs.promises.stat(filePath);
        out.push({ filePath, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* file vanished between readdir and stat */
      }
    }
  }
  return out;
}

export interface ScanResult {
  sessions: SessionMeta[];
  scanned: number;
  reused: number;
}

/**
 * Index every session file, reusing cached entries whose mtime and size are unchanged.
 * Files that fail to index are skipped rather than aborting the scan.
 */
export async function scanProjects(
  projectsDir: string,
  cache: ReadonlyMap<string, SessionMeta>,
  onProgress?: (done: number, total: number) => void,
): Promise<ScanResult> {
  const files = await listSessionFiles(projectsDir);
  const sessions: SessionMeta[] = [];
  let scanned = 0;
  let reused = 0;
  const concurrency = 4;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      const cached = cache.get(f.filePath);
      if (cached && cached.mtime === f.mtime && cached.size === f.size) {
        sessions.push(cached);
        reused++;
      } else {
        try {
          sessions.push(await indexFile(f.filePath));
          scanned++;
        } catch {
          /* unreadable file, skip */
        }
      }
      onProgress?.(sessions.length, files.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { sessions, scanned, reused };
}

export interface ProjectGroup {
  cwd: string;
  name: string;
  sessions: SessionMeta[];
  lastActivityAt: number;
}

/** Group by cwd, projects by most recent activity, sessions newest first. */
export function groupByProject(sessions: SessionMeta[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();
  for (const s of sessions) {
    let g = map.get(s.cwd);
    if (!g) {
      g = { cwd: s.cwd, name: s.projectName, sessions: [], lastActivityAt: 0 };
      map.set(s.cwd, g);
    }
    g.sessions.push(s);
    g.lastActivityAt = Math.max(g.lastActivityAt, activityOf(s));
  }
  const groups = [...map.values()];
  // Minute granularity keeps rows from reordering while a session is being written to.
  for (const g of groups) {
    g.sessions.sort((a, b) => activityMinute(b) - activityMinute(a) || a.title.localeCompare(b.title));
  }
  groups.sort((a, b) => minute(b.lastActivityAt) - minute(a.lastActivityAt) || a.name.localeCompare(b.name));
  return groups;
}

export function activityOf(s: SessionMeta): number {
  return s.lastActivityAt ?? s.mtime;
}

export function activityMinute(s: SessionMeta): number {
  return minute(activityOf(s));
}

function minute(ts: number): number {
  return Math.floor(ts / 60_000);
}
