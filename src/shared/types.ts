export type TitleSource = "custom" | "ai" | "prompt" | "command" | "date" | "id";

export interface SessionMeta {
  sessionId: string;
  filePath: string;
  /** Real working directory recorded in the log, or a decoded directory name fallback. */
  cwd: string;
  projectName: string;
  title: string;
  titleSource: TitleSource;
  firstPrompt?: string;
  /** Epoch ms of the first and last displayed message. */
  startedAt?: number;
  lastActivityAt?: number;
  messageCount: number;
  gitBranch?: string;
  filesChanged: number;
  mtime: number;
  size: number;
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** True when the host trimmed the result to keep the payload small. */
  truncated?: boolean;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
      summary: string;
      result?: ToolResult;
    }
  /** A pasted image, inline as base64. */
  | { type: "image"; mediaType: string; data: string }
  /** A pasted image the host left out because its base64 was over the size cap. */
  | { type: "image"; omitted: true; bytes: number };

/**
 * What a turn is. "agent" and "system" are user records injected by tooling
 * (teammate messages, system reminders, command echoes) rather than typed by a person.
 */
export type TurnKind = "user" | "assistant" | "agent" | "system";

export interface Turn {
  uuid: string;
  role: "user" | "assistant";
  kind: TurnKind;
  timestamp: number;
  blocks: Block[];
  /** Agent turns: who sent the message. */
  agentName?: string;
  /** Agent turns: the one-line summary attribute, when present. */
  summary?: string;
  /** System turns: short label derived from the tag, like "task notification". */
  label?: string;
  /** Name of the subagent whose transcript this turn came from; absent for the main transcript. */
  agent?: string;
}

export type SubagentStatus = "running" | "done";

/** One subagent transcript next to a session, listed from its meta.json and a cheap stat. */
export interface SubagentInfo {
  agentId: string;
  name: string;
  description: string;
  model?: string;
  color?: string;
  /** The Agent tool_use id in the parent transcript that spawned this agent, when recorded. */
  toolUseId?: string;
  filePath: string;
  size: number;
  startedAt?: number;
  endedAt?: number;
  status: SubagentStatus;
}

export interface FileHunk {
  tool: string;
  /** Subagent that made this edit; absent when the main transcript did. */
  agent?: string;
  before: string;
  after: string;
  added: number;
  removed: number;
}

export interface FileChange {
  path: string;
  hunks: FileHunk[];
  /** Subagents that edited this file, in first-edit order. */
  agents?: string[];
  added: number;
  removed: number;
  /** Whole-file reconstruction, present only when every edit applied cleanly. */
  before?: string;
  after?: string;
  partial: boolean;
}

export interface SessionData {
  meta: SessionMeta;
  turns: Turn[];
  files: FileChange[];
}
