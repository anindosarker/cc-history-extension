import * as path from "node:path";
import * as vscode from "vscode";
import type { FileChange, SessionMeta } from "../shared/types";

export const DIFF_SCHEME = "cc-history-diff";

/** Serves the "before" and "after" text of session edits as read-only virtual documents. */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private seq = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docs.get(uri.toString()) ?? "";
  }

  /** Register a document whose path ends with the real basename so VS Code picks the language. */
  private register(side: string, filePath: string, content: string): vscode.Uri {
    const id = ++this.seq;
    const uri = vscode.Uri.from({
      scheme: DIFF_SCHEME,
      path: `/${id}/${side}/${path.basename(filePath)}`,
      query: encodeURIComponent(filePath),
    });
    this.docs.set(uri.toString(), content);
    this.emitter.fire(uri);
    return uri;
  }

  async openDiff(meta: SessionMeta, file: FileChange, hunkIndex?: number): Promise<void> {
    const base = path.basename(file.path);
    let before: string;
    let after: string;
    let label: string;
    if (hunkIndex !== undefined) {
      const h = file.hunks[hunkIndex];
      if (!h) return;
      before = h.before;
      after = h.after;
      label = `hunk ${hunkIndex + 1}`;
    } else if (file.before !== undefined && file.after !== undefined) {
      before = file.before;
      after = file.after;
      label = "session";
    } else {
      // Partial reconstruction: show every hunk back to back.
      const sep = "\n\n/* ... */\n\n";
      before = file.hunks.map((h) => h.before).join(sep);
      after = file.hunks.map((h) => h.after).join(sep);
      label = "hunks";
    }
    const left = this.register("before", file.path, before);
    const right = this.register("after", file.path, after);
    const title = `${base} (${label} before) ↔ ${base} (${label} after)`;
    await vscode.commands.executeCommand("vscode.diff", left, right, title, {
      preview: true,
    } satisfies vscode.TextDocumentShowOptions);
    void meta;
  }

  dispose(): void {
    this.emitter.dispose();
    this.docs.clear();
  }
}
