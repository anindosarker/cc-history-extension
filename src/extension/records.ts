/** Loose shape of one jsonl record. Everything is optional because files vary by version. */
export interface RawRecord {
  type?: string;
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
  message?: {
    id?: string;
    role?: string;
    content?: unknown;
  };
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
}

export function asRecord(v: unknown): RawRecord | undefined {
  return typeof v === "object" && v !== null ? (v as RawRecord) : undefined;
}

const NOISE_PREFIXES = ["<command-name>", "<command-message>", "<local-command-stdout>", "<local-command-caveat>"];

/** Slash-command echo and other local-command noise that should never be displayed. */
export function isNoiseUserContent(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const s = content.trimStart();
  return NOISE_PREFIXES.some((p) => s.startsWith(p));
}

/** The slash command inside a command echo, like "/review", or undefined. */
export function extractCommandName(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const m = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(content);
  return m?.[1] || undefined;
}

export type RecordKind = "user" | "assistant" | "toolResultOnly" | "skip";

/** Decide whether a record contributes a visible turn. Shared by the indexer and the parser. */
export function classifyRecord(r: RawRecord): RecordKind {
  if (r.type !== "user" && r.type !== "assistant") return "skip";
  if (r.isMeta || r.isSidechain) return "skip";
  const content = r.message?.content;
  if (content === undefined || content === null) return "skip";
  if (r.type === "assistant") return "assistant";
  if (isNoiseUserContent(content)) return "skip";
  if (typeof content === "string") return content.trim() ? "user" : "skip";
  if (!Array.isArray(content)) return "skip";
  let hasVisible = false;
  let hasResult = false;
  for (const b of content as RawBlock[]) {
    if (b?.type === "tool_result") hasResult = true;
    else if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) hasVisible = true;
    else if (b?.type === "image") hasVisible = true;
  }
  if (hasVisible) return "user";
  return hasResult ? "toolResultOnly" : "skip";
}

export function blocksOf(content: unknown): RawBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as RawBlock[]) : [];
}

/** Plain text of a user record, used for the first-prompt title fallback. */
export function userPlainText(content: unknown): string {
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
