# Changelog

## 0.4.7

- Pin hover actions share one upright pin shape: outline to pin, filled to unpin.

## 0.4.6

- Pinned project rows keep their folder icon; the hover action to unpin is a filled pin.

## 0.4.5

- Pin projects to the top: current workspace projects are pinned by default, any project can be pinned from the row's hover action, and a current one can be unpinned. Pins are remembered per workspace. Pinned rows show a filled pin instead of the folder icon; the "cur" badge is gone.
- The divider row below pinned projects is removed.

## 0.4.4

- Only repository roots that contain the workspace are pinned as current; the home folder no longer is.
- The divider below pinned projects is a plain rule.

## 0.4.3

- Usage polling throttled: 5 minute default, one fetch per machine via a shared cache, Retry-After aware backoff on HTTP 429 with an automatic pause, manual refresh limited to once a minute.
- Privacy-safe screenshots and tour video rendered from synthetic demo data.
- Current workspace projects pinned at the top of the tree with a divider; Sort by activity, name or session count.
- Agents list by name in spawn order with running, done and failed states, matching Claude Code.
- Live reload: open sessions tail new messages, with a Reload button, a new-messages pill and a Live indicator.

## 0.4.2

- README screenshots and tour video removed; privacy-safe replacements follow.

## 0.4.1

- Marketplace listing renamed to "CC History" (the previous display name was taken). Everything inside VS Code is unchanged.

## 0.4.0

- Usage widget hardening: the last good reading stays on screen instead of "?" when a poll fails, credential reads are retried, and every poll outcome goes to a "Claude Code History" output channel (Show Usage Log).
- New tree settings: `ccHistory.tree.showStatus` turns the live status dots and their watcher and poll off, and `ccHistory.tree.hideProjects` hides projects by glob from the tree, Find Session and the week summary. Both apply live. Temp folders are hidden by default.
- One-time notice on first activation explaining that the usage widget reads the Claude Code login from the Keychain, with a button to turn it off.
- Marketplace metadata: icon, gallery banner, categories, keywords, repository and issue links; screenshots and a Privacy section in the README.

## 0.3.2

- Color accents: status dots and colored names on tool lines, +N -M counts with a mini diff for edits, yellow Bash summaries, blue agent names and mentions, fold counts by run status, yellow rule on usage-limit notices.
- Scroll to top now settles on the first turn; Home and End too.
- Human, locale-aware dates in the header and tooltips.
- Project folder button with full-path tooltip, Finder reveal and a context menu; project tree nodes gain Open in Finder and Copy Path.
- Truncated titles show an instant tooltip and wrap on click.
- Status bar color coding settings: thresholds, color mode, color source, text format, pulse icon. Usage panel bars use the same thresholds.

## 0.3.1

- Tool lines no longer overflow at narrow widths; MCP tool names show their short form.
- File path buttons stack under the tool line in narrow panels.
- Single-segment absolute paths without an extension are no longer linked.

## 0.3.0

- Two-tier visual hierarchy: message content in a centered 960px column at 14.5px, everything else (tool lines, thinking, folds, system lines, dates) small and dim.
- Two-row header: title, agents chip and meta with a Resume button and a "..." menu; tabs, search with an in-field match counter and a Filters popover.
- Fading scroll-to-top and scroll-to-bottom buttons; Home and End keys.
- Recap cards from Claude Code session summaries, plus notices for compaction and usage-limit waits.
- Clickable file paths in messages and tool lines, with line and column support.
- Themed tab icons for session and usage panels.

## 0.2.1

- Blue-tinted user bubbles with the time inside, and date dividers between days.
- Tool-only assistant runs fold into "Worked for Xm" rows with Expand all.
- Tool calls render as plain "Used <tool>" lines.
- Pasted images render inline inside user messages (3 MB cap).
- Usage widget caches credentials in memory until the token expires; README documents what it reads.
- Agent cards summarize idle notifications instead of showing raw JSON.

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
