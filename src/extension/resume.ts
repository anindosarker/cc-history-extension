import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { SessionMeta } from "../shared/types";
import { getClaudeCommand } from "./config";
import { resumeCommand, shellQuote } from "./resumeCommand";

const TERMINAL_NAME = "Claude Code";

/** Open (or reuse) a terminal in the session's directory and run `claude --resume`, optionally in bypass permissions mode. */
export function resumeSession(meta: SessionMeta, opts?: { bypass?: boolean }): void {
  const cwd = fs.existsSync(meta.cwd) ? meta.cwd : os.homedir();
  let terminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && t.exitStatus === undefined);
  if (!terminal) {
    terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  } else {
    terminal.sendText(`cd ${shellQuote(cwd)}`);
  }
  terminal.show();
  terminal.sendText(resumeCommand(getClaudeCommand(), meta, opts?.bypass));
}
