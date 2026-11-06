import * as os from "node:os";
import * as vscode from "vscode";
import { getClaudeCommand } from "./config";

const TERMINAL_NAME = "Claude Login";

/**
 * Open a new terminal in the home folder and run `claude auth login`. When that terminal closes,
 * `onClosed` runs so the usage widget can re-read the credentials of the account now signed in.
 */
export function switchAccount(onClosed: () => void): vscode.Disposable {
  const terminal = vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: os.homedir() });
  const sub = vscode.window.onDidCloseTerminal((t) => {
    if (t !== terminal) return;
    sub.dispose();
    onClosed();
  });
  terminal.show();
  terminal.sendText(`${getClaudeCommand()} auth login`);
  return sub;
}
