import * as fs from "node:fs";
import * as path from "node:path";
import { agentTag, failedAgentNames, orderAgents, spawnOrder } from "../shared/agents";
import type { FileChange, SessionMeta, SubagentInfo, SubagentStatus, Turn } from "../shared/types";
import { extractFileChanges } from "./diff";
import { tryParseJson } from "./jsonl";
import { parseSessionFile, type ParsedSession } from "./parser";
import { asRecord, parseTimestamp, userPlainText } from "./records";

/** An agent whose last record is older than this, or whose parent has no live process, is done. */
export const AGENT_RUNNING_WINDOW_MS = 2 * 60_000;
/** How much of each end of a transcript to read for the first and last timestamps. */
const EDGE_BYTES = 64 * 1024;
/** A single record can be larger than one chunk; give up on the head after this much. */
const MAX_HEAD_BYTES = 4 * 1024 * 1024;
const DESCRIPTION_MAX = 120;

/** Loose shape of agent-<id>.meta.json; every field is optional because older agents wrote fewer. */
export interface SubagentMeta {
  name?: string;
  agentType?: string;
  description?: string;
  model?: string;
  color?: string;
  toolUseId?: string;
}

/** `<projectDir>/<sessionId>/subagents`, next to the session's own jsonl. */
export function subagentsDir(meta: Pick<SessionMeta, "filePath" | "sessionId">): string {
  return path.join(path.dirname(meta.filePath), meta.sessionId, "subagents");
}

/** "agent-asia-backend-c8111228980700ba.jsonl" to "sia-backend"; hash-only names like "agent-ab22...53" give undefined. */
export function nameFromFileName(fileName: string): string | undefined {
  const base = path.basename(fileName, ".jsonl");
  const m = /^agent-a(.+)-[0-9a-f]{16}$/.exec(base);
  return m?.[1] || undefined;
}

export function agentIdFromFileName(fileName: string): string {
  const base = path.basename(fileName, ".jsonl");
  return base.startsWith("agent-") ? base.slice("agent-".length) : base;
}

/**
 * failed: the main transcript holds a failed idle notification for the agent, or its last assistant
 * message stopped with an error. unknown: no record to judge by. Otherwise running while the parent
 * is alive and the log is fresh, else done.
 */
export function computeAgentStatus(input: {
  endedAt: number | undefined;
  now: number;
  parentAlive: boolean;
  failed?: boolean;
}): SubagentStatus {
  if (input.failed) return "failed";
  if (input.endedAt === undefined) return "unknown";
  if (!input.parentAlive) return "done";
  return input.now - input.endedAt <= AGENT_RUNNING_WINDOW_MS ? "running" : "done";
}

export interface TranscriptEdges {
  startedAt?: number;
  endedAt?: number;
  /** Plain text of the first user record, the prompt the parent sent. */
  firstPrompt?: string;
  /** stop_reason of the last assistant record in the tail, like "end_turn" or "error". */
  lastStopReason?: string;
}

/** Timestamps from the first and last records without reading the middle of the file. */
export async function readTranscriptEdges(filePath: string, size: number): Promise<TranscriptEdges> {
  const out: TranscriptEdges = {};
  if (size === 0) return out;
  const fh = await fs.promises.open(filePath, "r");
  try {
    const first = await readFirstLine(fh, size);
    const firstRec = first !== undefined ? asRecord(tryParseJson(first)) : undefined;
    if (firstRec) {
      const ts = parseTimestamp(firstRec.timestamp);
      if (ts !== undefined) out.startedAt = ts;
      if (firstRec.type === "user") {
        const text = userPlainText(firstRec.message?.content);
        if (text) out.firstPrompt = text;
      }
    }
    const tailStart = Math.max(0, size - EDGE_BYTES);
    const tail = await readRange(fh, tailStart, size - tailStart);
    const lines = tail.split("\n");
    // The first line of the tail is usually cut in half, unless the tail is the whole file.
    if (tailStart > 0) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const rec = asRecord(tryParseJson(lines[i]));
      if (!rec) continue;
      if (out.lastStopReason === undefined && rec.type === "assistant" && typeof rec.message?.stop_reason === "string") {
        out.lastStopReason = rec.message.stop_reason;
      }
      const ts = parseTimestamp(rec.timestamp);
      if (ts !== undefined && out.endedAt === undefined) out.endedAt = ts;
      if (out.endedAt !== undefined && out.lastStopReason !== undefined) break;
    }
  } finally {
    await fh.close();
  }
  return out;
}

async function readFirstLine(fh: fs.promises.FileHandle, size: number): Promise<string | undefined> {
  let buf = "";
  let pos = 0;
  while (pos < size && pos < MAX_HEAD_BYTES) {
    const chunk = await readRange(fh, pos, Math.min(EDGE_BYTES, size - pos));
    pos += EDGE_BYTES;
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl !== -1) return buf.slice(0, nl);
  }
  return pos >= size ? buf : undefined;
}

async function readRange(fh: fs.promises.FileHandle, start: number, length: number): Promise<string> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, start);
  return buf.toString("utf8", 0, bytesRead);
}

export function readMeta(metaPath: string): SubagentMeta | undefined {
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as SubagentMeta) : undefined;
  } catch {
    return undefined;
  }
}

function clip(s: string): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > DESCRIPTION_MAX ? oneLine.slice(0, DESCRIPTION_MAX - 1).trimEnd() + "…" : oneLine;
}

export interface ListOptions {
  now?: number;
  /** Whether the parent session still has a live Claude process. */
  parentAlive: boolean;
  /** The main transcript: gives the spawn order and the failed idle notifications. */
  mainTurns?: readonly Turn[];
}

/**
 * Subagent transcripts of a session in spawn order (the main transcript's `Agent` calls), by start
 * time when no call matches. Reads meta.json, a stat and the two ends of each transcript; nothing
 * is parsed until an agent is opened.
 */
export async function listSubagents(meta: SessionMeta, opts: ListOptions): Promise<SubagentInfo[]> {
  const dir = subagentsDir(meta);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const now = opts.now ?? Date.now();
  const failedNames = failedAgentNames(opts.mainTurns ?? []);
  const out: SubagentInfo[] = [];
  for (const file of names) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, file);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const m = readMeta(path.join(dir, file.slice(0, -".jsonl".length) + ".meta.json")) ?? {};
    let edges: TranscriptEdges = {};
    try {
      edges = await readTranscriptEdges(filePath, stat.size);
    } catch {
      /* unreadable transcript, list it anyway */
    }
    const agentId = agentIdFromFileName(file);
    const name = str(m.name) ?? nameFromFileName(file);
    const agentType = str(m.agentType);
    const description = str(m.description) ?? (edges.firstPrompt ? clip(edges.firstPrompt) : (name ?? agentType ?? agentId));
    const endedAt = edges.endedAt ?? stat.mtimeMs;
    const failed = (name !== undefined && failedNames.has(name)) || edges.lastStopReason === "error";
    const info: SubagentInfo = {
      agentId,
      description,
      filePath,
      size: stat.size,
      endedAt,
      status: computeAgentStatus({ endedAt, now, parentAlive: opts.parentAlive, failed }),
    };
    if (name) info.name = name;
    if (agentType) info.agentType = agentType;
    if (edges.startedAt !== undefined) info.startedAt = edges.startedAt;
    if (str(m.model)) info.model = m.model;
    if (str(m.color)) info.color = m.color;
    if (str(m.toolUseId)) info.toolUseId = m.toolUseId;
    out.push(info);
  }
  out.sort((a, b) => (a.startedAt ?? a.endedAt ?? 0) - (b.startedAt ?? b.endedAt ?? 0) || agentTag(a).localeCompare(agentTag(b)));
  return orderAgents(out, spawnOrder(opts.mainTurns ?? []));
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Parse one subagent transcript. Sidechain records are the whole file, so they are kept. */
export function parseSubagentFile(info: SubagentInfo): Promise<ParsedSession> {
  return parseSessionFile(info.filePath, { sidechain: true, agent: agentTag(info) });
}

/** File changes across the main transcript and every subagent transcript, in timestamp order. */
export function mergedFileChanges(mainTurns: Turn[], agentTurns: Turn[][]): FileChange[] {
  const all: Turn[] = [...mainTurns];
  for (const turns of agentTurns) all.push(...turns);
  // Stable sort keeps each transcript's own order where timestamps tie or are missing.
  const indexed = all.map((t, i) => ({ t, i }));
  indexed.sort((a, b) => (a.t.timestamp || 0) - (b.t.timestamp || 0) || a.i - b.i);
  return extractFileChanges(indexed.map((x) => x.t));
}
