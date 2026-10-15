# Claude Code History

A read-only VS Code viewer for your Claude Code session logs. Every session, every project, no seven-day window.

![Screenshot placeholder](media/screenshot.png)

## What it does

- Lists all sessions under `~/.claude/projects`, grouped by project and sorted by recent activity.
- Opens a session in an editor tab with virtualized messages, markdown rendering, collapsible thinking blocks and tool calls.
- Searches inside a session (case-insensitive, with match count, next and previous navigation, and highlighting) and filters by role, thinking, and tool calls.
- Shows the files a session changed, with whole-file and per-hunk diffs in the native VS Code diff editor.
- Exports a transcript as plain text to a file or to the clipboard.
- Resumes a session with `claude --resume <id>` in an integrated terminal.

It never writes to your session logs and has no chat features, cost analytics or subagent transcripts.

## Install from the .vsix

```sh
code --install-extension cc-history-0.1.0.vsix
```

Or in VS Code: Extensions view, the `...` menu, "Install from VSIX...".

## Usage

- Click the clock icon in the activity bar to open the Sessions view.
- Click a session to open it. Right-click for Resume, Export, Copy Session ID and Reveal JSONL.
- Use the search icon in the view title (or the "Claude Code History: Find Session" command) to search across all sessions.
- Inside a session, press Cmd+F (Ctrl+F on Windows and Linux) to focus the message search. Enter goes to the next match, Shift+Enter to the previous one, Escape clears.

### Move the view

The view lives in a container, so you can drag the "Claude Code History" icon from the activity bar into the secondary sidebar or the bottom panel. Drag it back to the activity bar to undo.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ccHistory.projectsDir` | `~/.claude/projects` | Folder containing Claude Code project logs. |
| `ccHistory.claudeCommand` | `claude` | Command used when resuming a session. |
| `ccHistory.export.includeToolResults` | `false` | Include tool results in text exports. |
| `ccHistory.export.includeThinking` | `false` | Include thinking blocks in text exports. |

## Development

Requires Node 20+ and pnpm 10.

```sh
pnpm install
pnpm build        # host (esbuild) and webview (vite)
pnpm typecheck
pnpm lint
pnpm test         # vitest unit tests
pnpm smoke        # index your real ~/.claude/projects and print timings
pnpm package      # builds and writes cc-history-0.1.0.vsix
```

Press F5 in VS Code to launch an Extension Development Host with the "Run Extension" configuration. The `watch` task rebuilds the host and webview on change.

### Layout

```
src/extension   extension host: indexer, streaming parser, tree, webview panel, diffs, export, resume
src/shared      types and the host to webview message protocol
src/webview     React UI (Vite, Tailwind v4, vendored shadcn components)
media           activity bar icon
tests           vitest unit tests with synthetic fixtures
scripts         smoke test against real data
```

## License

MIT
