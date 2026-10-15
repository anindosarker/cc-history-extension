import * as crypto from "node:crypto";
import * as vscode from "vscode";

export type WebviewView = "session" | "usage";

/** The shell page for the shared React bundle; `view` tells main.tsx which app to mount. */
export function webviewHtml(webview: vscode.Webview, webviewRoot: vscode.Uri, title: string, view: WebviewView): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "index.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "index.css"));
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>${escapeHtml(title)}</title>
</head>
<body data-view="${view}">
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
