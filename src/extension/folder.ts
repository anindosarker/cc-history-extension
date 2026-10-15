import * as fs from "node:fs";
import * as vscode from "vscode";

/** Reveal a project folder in the OS file manager, or say that it is gone. */
export async function revealFolder(cwd: string): Promise<void> {
  if (!fs.existsSync(cwd)) {
    void vscode.window.showInformationMessage(`Folder not found: ${cwd}`);
    return;
  }
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(cwd));
}

export async function openFolderInNewWindow(cwd: string): Promise<void> {
  if (!fs.existsSync(cwd)) {
    void vscode.window.showInformationMessage(`Folder not found: ${cwd}`);
    return;
  }
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(cwd), { forceNewWindow: true });
}

export function addFolderToWorkspace(cwd: string): void {
  if (!fs.existsSync(cwd)) {
    void vscode.window.showInformationMessage(`Folder not found: ${cwd}`);
    return;
  }
  const count = vscode.workspace.workspaceFolders?.length ?? 0;
  vscode.workspace.updateWorkspaceFolders(count, 0, { uri: vscode.Uri.file(cwd) });
}

export async function copyPath(p: string): Promise<void> {
  await vscode.env.clipboard.writeText(p);
  void vscode.window.showInformationMessage(`Copied ${p}`);
}
