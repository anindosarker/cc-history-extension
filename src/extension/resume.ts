import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { getClaudeCommand } from "./config";

const TERMINAL_NAME = "Claude Code";

/** Open (or reuse) a terminal in the session's directory and run `claude --resume`. */
export function resumeSession(meta: SessionMeta): void {
  const cwd = fs.existsSync(meta.cwd) ? meta.cwd : os.homedir();
  let terminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && t.exitStatus === undefined);
  if (!terminal) {
    terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  } else {
    terminal.sendText(`cd ${shellQuote(cwd)}`);
  }
  terminal.show();
  terminal.sendText(`${getClaudeCommand()} --resume ${shellQuote(meta.sessionId)}`);
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
