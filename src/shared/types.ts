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
 * "recap" is an away_summary system record (content the person wants to read),
 * "notice" a compact_boundary or informational one (a one-line divider).
 */
export type TurnKind = "user" | "assistant" | "agent" | "system" | "recap" | "notice";

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
  /** Agent turns: the idle notification reported a failure (idleReason "failed" or a failureReason). */
  failed?: boolean;
  /** System turns: short label derived from the tag, like "task notification". */
  label?: string;
  /** Turns built from a top-level system record: its subtype, like "away_summary". */
  subtype?: string;
  /** Name of the subagent whose transcript this turn came from; absent for the main transcript. */
  agent?: string;
}

/** "unknown" when the transcript holds no record to judge by; the viewer shows a grey dot. */
export type SubagentStatus = "running" | "done" | "failed" | "unknown";

/** One subagent transcript next to a session, listed from its meta.json and a cheap stat. */
export interface SubagentInfo {
  agentId: string;
  /** The spawn name (meta.json or the file name). Absent for agents Claude Code did not name. */
  name?: string;
  /** The agent definition used, like "general-purpose"; shown only in tooltips. */
  agentType?: string;
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
  /** Workflow agents: the run that spawned it and its phase title, when the meta.json records one. */
  runId?: string;
  phase?: string;
}

/**
 * One workflow run of a session, from workflows/<runId>.json when the run has ended, else from its
 * journal. "running" while the parent is alive and no run file says otherwise; "unknown" for a
 * run that never wrote one. Other values ("completed", "killed", "failed") come from the run file.
 */
export interface WorkflowRun {
  runId: string;
  /** The workflow name, or the run id while the run file is missing. */
  name: string;
  summary?: string;
  status: string;
  startedAt?: number;
  durationMs?: number;
  /** Phase titles in the run's own order. */
  phases: string[];
  totalTokens?: number;
  totalToolCalls?: number;
  /** Agents grouped by phase in `phases` order, unphased last; journal start order within a phase. */
  agents: SubagentInfo[];
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
