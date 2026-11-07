import * as os from "node:os";
import * as vscode from "vscode";
import { getClaudeCommand } from "./config";

const TERMINAL_NAME = "Claude Login";

/**
 * Open a new terminal in the home folder and run `claude auth login`. The usage widget notices the
 * switch on its own (it watches ~/.claude.json); `onClosed` runs when the terminal closes as one more
 * look at that file, which applies a switch only if the watcher has not already.
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
