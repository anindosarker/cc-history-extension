import type { Block, Turn } from "../shared/types";
import { summarizeToolUse } from "../shared/toolSummary";
import { forEachLine, tryParseJson } from "./jsonl";
import {
  asRecord,
  blocksOf,
  classifyRecord,
  parseAgentText,
  parseTimestamp,
  systemLabel,
  toolResultText,
  usageTotal,
  userPlainText,
  userRawText,
  type ClassifyOptions,
  type RawBlock,
  type RawRecord,
} from "./records";

/** Tool results larger than this are trimmed before leaving the host. */
export const MAX_TOOL_RESULT_CHARS = 200_000;
/** Pasted images whose base64 is longer than this are replaced by a placeholder. */
export const MAX_IMAGE_BASE64_CHARS = 3 * 1024 * 1024;

/** Decoded size of a base64 string, ignoring padding. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** A pasted image as a block, capped so huge pastes do not bloat the payload. */
export function imageBlock(b: RawBlock): Block {
  const src = b.source;
  const data = src?.type === "base64" && typeof src.data === "string" ? src.data : "";
  if (!data) return { type: "text", text: "[image]" };
  if (data.length > MAX_IMAGE_BASE64_CHARS) return { type: "image", omitted: true, bytes: base64Bytes(data) };
  return { type: "image", mediaType: src?.media_type || "image/png", data };
}

export interface ParsedSession {
  sessionId?: string;
  cwd?: string;
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  startedAt?: number;
  lastActivityAt?: number;
  turns: Turn[];
  /** Tokens over every assistant message (input, output and cache), counted once per message id. */
  tokens: number;
}

export interface ParseOptions extends ClassifyOptions {
  /** Tag every turn with this subagent name. */
  agent?: string;
}

/**
 * Incrementally turns raw jsonl lines into display turns.
 * Consecutive assistant records that share a message id are merged into one turn,
 * and tool_result records are attached to their tool_use instead of shown as turns.
 */
export class SessionBuilder {
  private readonly result: ParsedSession = { turns: [], tokens: 0 };
  private readonly toolUses = new Map<string, Extract<Block, { type: "tool_use" }>>();
  private lastAssistantMsgId: string | undefined;
  private lastUsageMsgId: string | undefined;

  constructor(private readonly opts: ParseOptions = {}) {}

  push(line: string): void {
    const r = asRecord(tryParseJson(line));
    if (!r) return;
    this.noteMetadata(r);
    const kind = classifyRecord(r, this.opts);
    if (kind === "skip") return;
    const ts = parseTimestamp(r.timestamp) ?? this.result.lastActivityAt ?? 0;
    if (kind === "toolResultOnly") {
      this.attachResults(r);
      return;
    }
    if (kind === "user" || kind === "agent" || kind === "system") {
      this.attachResults(r);
      const uuid = r.uuid ?? `u-${this.result.turns.length}`;
      let turn: Turn;
      if (kind === "user") {
        turn = { uuid, role: "user", kind, timestamp: ts, blocks: this.userBlocks(r) };
        if (!this.result.firstPrompt) {
          const text = userPlainText(r.message?.content);
          if (text) this.result.firstPrompt = text;
        }
      } else if (kind === "agent") {
        const msg = parseAgentText(userRawText(r.message?.content));
        turn = { uuid, role: "user", kind, timestamp: ts, blocks: [{ type: "text", text: msg.body }] };
        if (msg.agentName) turn.agentName = msg.agentName;
        if (msg.summary) turn.summary = msg.summary;
      } else {
        const raw = userRawText(r.message?.content);
        turn = { uuid, role: "user", kind, timestamp: ts, blocks: [{ type: "text", text: raw }] };
        turn.label = systemLabel(raw) ?? "system";
      }
      this.lastAssistantMsgId = undefined;
      this.appendTurn(turn, ts);
      return;
    }
    const blocks = this.assistantBlocks(r);
    const msgId = r.message?.id;
    this.noteUsage(r, msgId);
    const prev = this.result.turns[this.result.turns.length - 1];
    if (msgId && msgId === this.lastAssistantMsgId && prev?.role === "assistant") {
      prev.blocks.push(...blocks);
      this.result.lastActivityAt = Math.max(this.result.lastActivityAt ?? 0, ts);
      return;
    }
    this.lastAssistantMsgId = msgId;
    this.appendTurn(
      { uuid: r.uuid ?? `a-${this.result.turns.length}`, role: "assistant", kind: "assistant", timestamp: ts, blocks },
      ts,
    );
  }

  finish(): ParsedSession {
    return this.result;
  }

  /** Streaming writes one record per content block, all carrying the same message usage, so count each id once. */
  private noteUsage(r: RawRecord, msgId: string | undefined): void {
    if (msgId && msgId === this.lastUsageMsgId) return;
    this.lastUsageMsgId = msgId;
    this.result.tokens += usageTotal(r.message?.usage);
  }

  private appendTurn(turn: Turn, ts: number): void {
    if (this.opts.agent) turn.agent = this.opts.agent;
    this.result.turns.push(turn);
    if (ts) {
      if (this.result.startedAt === undefined) this.result.startedAt = ts;
      this.result.lastActivityAt = Math.max(this.result.lastActivityAt ?? 0, ts);
    }
  }

  private noteMetadata(r: RawRecord): void {
    if (r.type === "custom-title" && typeof r.customTitle === "string") {
      this.result.customTitle = r.customTitle;
    } else if (r.type === "ai-title" && typeof r.aiTitle === "string") {
      this.result.aiTitle = r.aiTitle;
    }
    if (!this.result.sessionId && typeof r.sessionId === "string") this.result.sessionId = r.sessionId;
    if (r.type === "user" || r.type === "assistant") {
      if (!this.result.cwd && typeof r.cwd === "string" && r.cwd) this.result.cwd = r.cwd;
      if (typeof r.gitBranch === "string" && r.gitBranch) this.result.gitBranch = r.gitBranch;
    }
  }

  private attachResults(r: RawRecord): void {
    for (const b of blocksOf(r.message?.content)) {
      if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue;
      const use = this.toolUses.get(b.tool_use_id);
      if (!use) continue;
      let text = toolResultText(b.content);
      let truncated = false;
      if (text.length > MAX_TOOL_RESULT_CHARS) {
        text = text.slice(0, MAX_TOOL_RESULT_CHARS);
        truncated = true;
      }
      use.result = { text, isError: b.is_error === true, ...(truncated ? { truncated } : {}) };
    }
  }

  private userBlocks(r: RawRecord): Block[] {
    const out: Block[] = [];
    for (const b of blocksOf(r.message?.content)) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        out.push({ type: "text", text: b.text });
      } else if (b.type === "image") {
        out.push(imageBlock(b));
      }
    }
    return out;
  }

  private assistantBlocks(r: RawRecord): Block[] {
    const out: Block[] = [];
    for (const b of blocksOf(r.message?.content)) {
      if (b.type === "text" && typeof b.text === "string") {
        if (b.text.trim()) out.push({ type: "text", text: b.text });
      } else if (b.type === "thinking" && typeof b.thinking === "string") {
        if (b.thinking.trim()) out.push({ type: "thinking", thinking: b.thinking });
      } else if (b.type === "redacted_thinking") {
        out.push({ type: "thinking", thinking: "[redacted]" });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        const id = typeof b.id === "string" ? b.id : `tool-${this.toolUses.size}`;
        const block: Extract<Block, { type: "tool_use" }> = {
          type: "tool_use",
          id,
          name: b.name,
          input: b.input ?? {},
          summary: summarizeToolUse(b.name, b.input),
        };
        this.toolUses.set(id, block);
        out.push(block);
      }
    }
    return out;
  }
}

export function parseSessionText(text: string, opts: ParseOptions = {}): ParsedSession {
  const b = new SessionBuilder(opts);
  for (const line of text.split(/\r?\n/)) if (line) b.push(line);
  return b.finish();
}

export async function parseSessionFile(filePath: string, opts: ParseOptions = {}): Promise<ParsedSession> {
  const b = new SessionBuilder(opts);
  await forEachLine(filePath, (line) => b.push(line));
  return b.finish();
}
