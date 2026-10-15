# Changelog

## 0.2.0

- Status bar widget showing Claude Code 5-hour, weekly and scoped weekly usage with reset times.
- Usage panel with pace markers, projected usage at reset and a summary of this week's sessions.
- Subagent transcripts: Agents popover, agent view with search and token totals, links from Agent tool calls, and subagent edits in the files changed tab.
- Teammate messages, system reminders, task notifications and command echoes render as collapsed agent or system turns instead of user prompts.
- Minimal chat layout: soft user bubbles, plain assistant text, thin tool pills.
- Responsive viewer header at narrow panel widths.
- Old/New toggle to open a session at the first or latest message.
- Colored session icons and live status dots (running, open, recently ended).
- Fixed slash-command titles, dotted project path decoding, UUID fallback titles and tree jitter.

## 0.1.0

Initial release.

- Activity bar view listing every Claude Code session, grouped by project, with no time cutoff.
- Find Session quick pick across titles, projects and first prompts.
- Session viewer with virtualized messages, markdown rendering, collapsible thinking and tool calls.
- In-session search with match navigation, highlighting and role, thinking and tool filters.
- Files changed tab with whole-file and per-hunk diffs opened in the VS Code diff editor.
- Plain-text export to file or clipboard.
- Resume a session in an integrated terminal.
- Index cache in global state and a directory watcher that keeps the tree current.
