import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { SessionData } from "../shared/types";
import { getExportOptions } from "./config";
import { buildTranscript, exportFileName } from "./exporter";

/** Save the transcript to a .txt file or copy it to the clipboard. */
export async function exportSession(data: SessionData, mode: "file" | "clipboard"): Promise<void> {
  const text = buildTranscript(data, getExportOptions());
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
