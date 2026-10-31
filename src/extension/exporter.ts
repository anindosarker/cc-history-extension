import { formatFullDateTime, formatHumanDate } from "../shared/time";
import type { SessionData, Turn } from "../shared/types";

export interface ExportOptions {
  includeToolResults: boolean;
  includeThinking: boolean;
  /** Replaces the "# <title>" first line, used for subagent transcripts. */
  heading?: string;
  /**
   * "reference": user and Claude text only, one "## [n] User · <time>" heading per turn, for another
   * agent to grep. Tool calls, thinking and injected rows are left out whatever the other options say.
   */
  format?: "plain" | "reference";
}

/** Plain-text transcript in the spirit of Claude Code's /export. */
export function buildTranscript(data: SessionData, opts: ExportOptions): string {
  const { meta } = data;
  const lines: string[] = [];
  lines.push(opts.heading ?? `# ${meta.title}`);
  lines.push(`Project: ${meta.cwd}`);
  if (meta.startedAt) lines.push(`Date: ${formatFullDateTime(meta.startedAt)}`);
  if (meta.gitBranch) lines.push(`Branch: ${meta.gitBranch}`);
  lines.push(`Session: ${meta.sessionId}`);
  lines.push("");
  if (opts.format === "reference") {
    referenceTurns(data).forEach(({ turn, body }, i) => lines.push(referenceHeading(turn, i + 1), body, ""));
    return lines.join("\n").trimEnd() + "\n";
  }
  for (const turn of data.turns) {
    if ((turn.kind === "system" || turn.kind === "notice") && !opts.includeToolResults) continue;
    const body = renderTurn(turn, opts);
    if (!body) continue;
    lines.push(turnHeading(turn));
    lines.push(body);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function turnHeading(turn: Turn): string {
  switch (turn.kind) {
    case "assistant":
      return "Assistant:";
    case "agent":
      return turn.agentName ? `Agent (${turn.agentName}):` : "Agent:";
    case "system":
      return turn.label ? `System (${turn.label}):` : "System:";
    case "recap":
      return "Recap:";
    case "notice":
      return "Notice:";
    default:
      return "User:";
  }
}

function renderTurn(turn: Turn, opts: ExportOptions): string {
  const parts: string[] = [];
  for (const b of turn.blocks) {
    if (b.type === "text") {
      parts.push(b.text.trimEnd());
    } else if (b.type === "thinking") {
      if (opts.includeThinking) parts.push(`[Thinking]\n${b.thinking.trimEnd()}`);
    } else if (b.type === "image") {
      parts.push("[image]");
    } else {
      parts.push(`[Tool: ${b.name}] ${b.summary}`.trimEnd());
      if (opts.includeToolResults && b.result) {
        const label = b.result.isError ? "[Tool error]" : "[Tool result]";
        parts.push(`${label}\n${b.result.text.trimEnd()}`);
      }
    }
  }
  return parts.join("\n").trim();
}

/** Turns the reference format keeps: typed user messages and Claude replies that hold text. */
function referenceTurns(data: SessionData): { turn: Turn; body: string }[] {
  const out: { turn: Turn; body: string }[] = [];
  for (const turn of data.turns) {
    if (turn.kind !== "user" && turn.kind !== "assistant") continue;
    const body = turn.blocks
      .map((b) => (b.type === "text" ? b.text.trim() : b.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n\n");
    if (body) out.push({ turn, body });
  }
  return out;
}

function referenceHeading(turn: Turn, n: number): string {
  const who = turn.kind === "assistant" ? "Claude" : "User";
  return turn.timestamp ? `## [${n}] ${who} · ${formatFullDateTime(turn.timestamp)}` : `## [${n}] ${who}`;
}

/** Number of "## [n]" messages the reference format writes for this session. */
export function referenceMessageCount(data: SessionData): number {
  return referenceTurns(data).length;
}

export interface AgentPromptInfo {
  title: string;
  projectName: string;
  startedAt?: number;
  messageCount: number;
  /** Absolute path of the reference transcript. */
  path: string;
}

/** The prompt that points a new agent at a reference transcript without loading all of it. */
export function agentPrompt(info: AgentPromptInfo): string {
  const facts = [info.projectName, info.startedAt ? formatHumanDate(info.startedAt) : undefined, `${info.messageCount} messages`];
  return [
    `Earlier Claude Code session: "${info.title}" (${facts.filter(Boolean).join(", ")}).`,
    `Transcript: "${info.path}"`,
    `It holds messages only, one "## [n] User|Claude · <time>" heading per turn.`,
    "Do not read the whole file. grep -n for what you need, then read only those line ranges.",
    "Question:",
  ].join("\n");
}

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "session";
}

export function exportFileName(title: string, startedAt: number | undefined): string {
  const d = startedAt ? new Date(startedAt) : new Date();
  const ymd = d.toISOString().slice(0, 10);
  return `${slugify(title)}-${ymd}.txt`;
}
