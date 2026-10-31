import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { SessionData } from "../shared/types";
import { getExportOptions } from "./config";
import { agentPrompt, buildTranscript, exportFileName, referenceMessageCount } from "./exporter";

/** Save the transcript to a .txt file or copy it to the clipboard. */
export async function exportSession(data: SessionData, mode: "file" | "clipboard", heading?: string): Promise<void> {
  const text = buildTranscript(data, { ...getExportOptions(), ...(heading ? { heading } : {}) });
  if (mode === "clipboard") {
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      `Copied transcript to clipboard (${text.length.toLocaleString()} characters).`,
    );
    return;
  }
  const name = exportFileName(data.meta.title, data.meta.startedAt);
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(os.homedir(), name)),
    filters: { "Text files": ["txt"], "All files": ["*"] },
    saveLabel: "Export",
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
  const open = "Open";
  const choice = await vscode.window.showInformationMessage(`Exported to ${target.fsPath}`, open);
  if (choice === open) await vscode.window.showTextDocument(target);
}

/**
 * Write the reference transcript to <storage>/refs/<sessionId>.md (overwriting an older copy, so a
 * live session is always current) and copy a prompt that points a new agent at it.
 */
export async function copyAgentPrompt(data: SessionData, storageUri: vscode.Uri): Promise<void> {
  const text = buildTranscript(data, { includeToolResults: false, includeThinking: false, format: "reference" });
  const dir = vscode.Uri.joinPath(storageUri, "refs");
  await vscode.workspace.fs.createDirectory(dir);
  const target = vscode.Uri.joinPath(dir, `${data.meta.sessionId}.md`);
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
  const { title, projectName, startedAt } = data.meta;
  const messageCount = referenceMessageCount(data);
  await vscode.env.clipboard.writeText(agentPrompt({ title, projectName, startedAt, messageCount, path: target.fsPath }));
  void vscode.window.showInformationMessage("Prompt copied");
}
