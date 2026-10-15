import { formatFullDateTime, type DateFormatOptions } from "../shared/time";
import type { SessionMeta } from "../shared/types";

/** Markdown-escaped lines of a session's tree tooltip, in order. Pure so the text can be tested without vscode. */
export function sessionTooltipLines(m: SessionMeta, status: string | undefined, opts: DateFormatOptions = {}): string[] {
  const lines = [`**${escapeMd(m.title)}**`];
  if (status) lines.push(`Status: ${status}`);
  if (m.startedAt) lines.push(`Started: ${escapeMd(formatFullDateTime(m.startedAt, opts))}`);
  if (m.gitBranch) lines.push(`Branch: ${escapeMd(m.gitBranch)}`);
  lines.push(`Messages: ${m.messageCount}`);
  lines.push(`Session: \`${m.sessionId}\``);
  return lines;
}

export function escapeMd(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+!|-]/g, "\\$&");
}
