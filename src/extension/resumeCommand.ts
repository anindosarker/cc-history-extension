import type { SessionMeta } from "../shared/types";

/** The shell line that resumes a session, optionally with permission prompts bypassed. */
export function resumeCommand(claude: string, meta: SessionMeta, bypass = false): string {
  const cmd = `${claude} --resume ${shellQuote(meta.sessionId)}`;
  return bypass ? `${cmd} --permission-mode bypassPermissions` : cmd;
}

export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
