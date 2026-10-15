/** Loose shape of one jsonl record. Everything is optional because files vary by version. */
export interface RawRecord {
  type?: string;
  /** Top-level system records: "away_summary", "compact_boundary", "informational", ... */
  subtype?: string;
  /** Top-level system records: their one piece of text. */
  content?: unknown;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  gitBranch?: string;
  customTitle?: string;
  aiTitle?: string;
  agentId?: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown;
    usage?: RawUsage;
    stop_reason?: string | null;
  };
}

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Input, output and both cache buckets added together. */
export function usageTotal(u: RawUsage | undefined): number {
  if (!u) return 0;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return n(u.input_tokens) + n(u.output_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
}

export interface ClassifyOptions {
  /** Keep sidechain records; subagent transcripts are made of nothing else. */
  sidechain?: boolean;
}

export interface RawBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  /** Image blocks: {type: "base64", media_type, data}. */
  source?: { type?: string; media_type?: string; data?: string };
}

export function asRecord(v: unknown): RawRecord | undefined {
  return typeof v === "object" && v !== null ? (v as RawRecord) : undefined;
}

/** Prefixes of user text that tooling injected, with the label the viewer shows for each. */
const SYSTEM_PREFIXES: [prefix: string, label: string][] = [
  ["<system-reminder", "system reminder"],
  ["<task-notification", "task notification"],
  ["[SYSTEM NOTIFICATION", "system notification"],
  ["<ide_opened_file", "opened file"],
  ["<local-command-stdout", "command output"],
  ["<local-command-caveat", "command caveat"],
  ["<command-name", "command"],
  ["<command-message", "command"],
  ["[Request interrupted by user", "interrupted"],
];

const AGENT_WRAPPER = "Another Claude session sent a message:";
const AGENT_TAGS = ["<teammate-message", "<cross-session-message"];
/** How far into the text an agent tag may appear and still count. */
const AGENT_TAG_WINDOW = 200;

/** Label for system-shaped text, or undefined when the text is an ordinary prompt. */
export function systemLabel(text: string): string | undefined {
  const s = text.trimStart();
  for (const [prefix, label] of SYSTEM_PREFIXES) {
    if (s.startsWith(prefix)) {
      if (label === "command") {
        const name = extractCommandName(s);
        return name ? `command ${name}` : label;
      }
      return label;
    }
  }
  return undefined;
}

export function isAgentText(text: string): boolean {
  const s = text.trimStart();
  if (s.startsWith(AGENT_WRAPPER)) return true;
  const head = s.slice(0, AGENT_TAG_WINDOW);
  return AGENT_TAGS.some((t) => head.includes(t));
}

export interface AgentMessage {
  agentName?: string;
  summary?: string;
  body: string;
  /** An idle notification whose idleReason is "failed" or that carries a failureReason. */
  failed?: boolean;
}

/** Pull the sender, summary and body out of a teammate or cross-session message. */
export function parseAgentText(text: string): AgentMessage {
  let s = text.trim();
  if (s.startsWith(AGENT_WRAPPER)) s = s.slice(AGENT_WRAPPER.length).trimStart();
  const open = /^<(teammate-message|cross-session-message)\b([^>]*)>/.exec(s);
  let agentName: string | undefined;
  let summary: string | undefined;
  if (open) {
    const attrs = open[2];
    agentName = attr(attrs, "teammate_id") ?? attr(attrs, "from");
    summary = attr(attrs, "summary");
    s = s.slice(open[0].length);
    const closeRe = new RegExp(`</${open[1]}>\\s*$`);
    s = s.replace(closeRe, "");
  }
  let body = s.trim();
  const json = tryParseJsonObject(body);
  if (json) body = unwrapAgentJson(json, body);
  const out: AgentMessage = { agentName, summary, body };
  if (json && isFailedIdle(json)) out.failed = true;
  return out;
}

function isFailedIdle(json: Record<string, unknown>): boolean {
  if (json.type !== "idle_notification") return false;
  return json.idleReason === "failed" || (typeof json.failureReason === "string" && json.failureReason.trim() !== "");
}

/**
 * Readable text for a structured teammate payload. The result string wins; an idle notification
 * without one becomes a short status line; anything else keeps its JSON, pretty-printed.
 */
function unwrapAgentJson(json: Record<string, unknown>, raw: string): string {
  if (typeof json.result === "string" && json.result.trim()) return json.result.trim();
  for (const key of ["message", "text", "content"]) {
    const v = json[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (json.type === "idle_notification") {
    const reason = typeof json.idleReason === "string" ? json.idleReason : undefined;
    const failure = typeof json.failureReason === "string" ? json.failureReason : undefined;
    let line = reason ? `Idle (${reason})` : "Idle";
    if (failure) line += `: ${failure}`;
    return line;
  }
  try {
    return JSON.stringify(json, null, 2);
  } catch {
    return raw;
  }
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m?.[1] || undefined;
}

function tryParseJsonObject(s: string): Record<string, unknown> | undefined {
  if (!s.startsWith("{")) return undefined;
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The slash command inside a command echo, like "/review", or undefined. */
export function extractCommandName(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const m = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(content);
  return m?.[1] || undefined;
}

export type RecordKind = "user" | "agent" | "system" | "assistant" | "toolResultOnly" | "recap" | "notice" | "skip";

/** Subtypes of top-level system records that become a turn, and what kind. The rest are skipped. */
const SYSTEM_RECORD_KINDS: Record<string, "recap" | "notice" | "system"> = {
  away_summary: "recap",
  compact_boundary: "notice",
  informational: "notice",
  scheduled_task_fire: "system",
  bridge_status: "system",
  local_command: "system",
};

/** Readable labels for the system-record subtypes shown as one-liners. */
const SYSTEM_RECORD_LABELS: Record<string, string> = {
  scheduled_task_fire: "scheduled task",
  bridge_status: "remote control",
};

/** Trailing hint Claude Code appends to every recap; not part of the summary. */
const RECAP_SUFFIX = /\s*\(disable recaps in \/config\)\s*$/;

/** Text of a top-level system record, or undefined when it has none. */
export function systemRecordText(r: RawRecord): string | undefined {
  return typeof r.content === "string" && r.content.trim() ? r.content.trim() : undefined;
}

/** Kind of turn a top-level system record becomes: a recap card, a notice divider, a system line, or nothing. */
export function systemRecordKind(r: RawRecord): "recap" | "notice" | "system" | "skip" {
  if (r.type !== "system" || typeof r.subtype !== "string") return "skip";
  if (!systemRecordText(r)) return "skip";
  return SYSTEM_RECORD_KINDS[r.subtype] ?? "skip";
}

/** One-liner label for a system record: the command echo's own label, or a fixed name per subtype. */
export function systemRecordLabel(subtype: string, text: string): string {
  return systemLabel(text) ?? SYSTEM_RECORD_LABELS[subtype] ?? subtype.replace(/_/g, " ");
}

export function recapText(text: string): string {
  return text.replace(RECAP_SUFFIX, "").trim();
}

/**
 * Decide whether a record contributes a visible turn, and of which kind. Shared by the indexer and the parser.
 * A user record is "system" only when every text block in it is system-shaped, so a prompt that
 * arrives bundled with an injected reminder still counts as the person's prompt.
 */
export function classifyRecord(r: RawRecord, opts: ClassifyOptions = {}): RecordKind {
  if (r.type === "system") return r.isSidechain && !opts.sidechain ? "skip" : systemRecordKind(r);
  if (r.type !== "user" && r.type !== "assistant") return "skip";
  if (r.isMeta) return "skip";
  if (r.isSidechain && !opts.sidechain) return "skip";
  const content = r.message?.content;
  if (content === undefined || content === null) return "skip";
  if (r.type === "assistant") return "assistant";
  if (typeof content === "string") return content.trim() ? classifyUserText(content) : "skip";
  if (!Array.isArray(content)) return "skip";
  const texts: string[] = [];
  let hasImage = false;
  let hasResult = false;
  for (const b of content as RawBlock[]) {
    if (b?.type === "tool_result") hasResult = true;
    else if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) texts.push(b.text);
    else if (b?.type === "image") hasImage = true;
  }
  if (texts.length === 0) return hasImage ? "user" : hasResult ? "toolResultOnly" : "skip";
  if (hasImage) return "user";
  if (texts.length === 1) return classifyUserText(texts[0]);
  if (texts.every((t) => systemLabel(t) !== undefined)) return "system";
  return "user";
}

function classifyUserText(text: string): "user" | "agent" | "system" {
  if (isAgentText(text)) return "agent";
  if (systemLabel(text) !== undefined) return "system";
  return "user";
}

export function blocksOf(content: unknown): RawBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as RawBlock[]) : [];
}

/** Plain text of a user record (injected system-shaped blocks left out), used for the first-prompt title fallback. */
export function userPlainText(content: unknown): string {
  return blocksOf(content)
    .filter((b) => b.type === "text" && typeof b.text === "string" && systemLabel(b.text) === undefined)
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

/** Every text block of a user record joined, system-shaped or not. */
export function userRawText(content: unknown): string {
  return blocksOf(content)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

/** Flatten a tool_result content value to text. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return (content as RawBlock[])
    .map((b) => {
      if (b?.type === "text" && typeof b.text === "string") return b.text;
      if (b?.type === "image") return "[image]";
      return b ? JSON.stringify(b) : "";
    })
    .join("\n");
}

export function parseTimestamp(ts: string | undefined): number | undefined {
  if (!ts) return undefined;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : undefined;
}
