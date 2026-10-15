import type { SessionData, Turn } from "../shared/types";

export interface ExportOptions {
  includeToolResults: boolean;
  includeThinking: boolean;
}

/** Plain-text transcript in the spirit of Claude Code's /export. */
export function buildTranscript(data: SessionData, opts: ExportOptions): string {
  const { meta } = data;
  const lines: string[] = [];
  lines.push(`# ${meta.title}`);
  lines.push(`Project: ${meta.cwd}`);
  if (meta.startedAt) lines.push(`Date: ${new Date(meta.startedAt).toISOString()}`);
  if (meta.gitBranch) lines.push(`Branch: ${meta.gitBranch}`);
  lines.push(`Session: ${meta.sessionId}`);
  lines.push("");
  for (const turn of data.turns) {
    if (turn.kind === "system" && !opts.includeToolResults) continue;
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
