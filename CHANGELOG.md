# Changelog

## 1.0.0

- Usage refresh reworked: clicking Refresh (or Retry, or "Refresh Usage") always fetches new numbers. There is no one-per-minute limit any more. If another VS Code window is already fetching, the click waits for that window's result and shows it. Only a rate limit after a `429` can hold a click back (the server's `Retry-After`, at least one minute), and the panel and status bar say until when.
- Only one VS Code window polls usage; the others share its result. Windows take turns through an exclusive lock file, so two windows never fetch at the same moment.
- After Switch Claude Account, every open window drops the old account's token and numbers, and a fetch still running with the old token is thrown away.
- Background polling is every 15 minutes by default (`ccHistory.usage.intervalSeconds`, at least 300). Focusing a window or opening the usage panel refreshes when the numbers are at least 5 minutes old.
- A `429 Too Many Requests` answer keeps the last numbers on screen, says "Rate limited, showing numbers from 12m ago", and holds every window for the server's `Retry-After` (at least one minute), and tries again after the poll interval or that `Retry-After`, whichever is longer. The 15 minute to 2 hour backoff ladder and the pause after three 429s are gone. Other failures say "Last refresh failed, showing numbers from 12m ago".
- Usage numbers over an hour old, or from a window that has reset since, are dropped instead of shown as current.
- A rejected or expired token is re-read on the next attempt instead of being retried every 30 seconds.
- The refresh button spins from the click until the result arrives, and the status bar icon spins while a refresh runs.
- Usage panel bars show their level colour at any percentage: the track is tinted with the level colour and the used part is solid.
- The usage panel header and the status bar tooltip show the signed-in account's email and organization, read from `~/.claude.json`.
- Hovering a usage bar or its pace marker explains it, with how much of that window has passed.
- The usage panel drops the "This week" summary of sessions, messages and top projects.
- Usage panel bars are coloured by level: green below the warning threshold, then the same warning and error colours as the status bar.
- Switch Claude Account: the account icon in the Sessions view title (or the "Claude Code History: Switch Claude Account" command) opens a "Claude Login" terminal running `claude auth login`. When you close that terminal, the usage widget re-reads the credentials and fetches usage for the new account. The usage panel (click the usage status bar item) has a "Switch account" button in its header, and also in the error box when credentials are missing or expired.

## 0.6.1

- Resume with bypass permissions: a session's right-click menu has "Resume in Claude Code (Bypass Permissions)", and the session view's resume button has a dropdown with the same option. It runs `claude --resume <id> --permission-mode bypassPermissions`. Plain Resume is unchanged.

## 0.6.0

- Copy prompt for another agent: from a session's right-click menu or the session view's `…` menu. It writes a clean, messages-only transcript with numbered turns to the extension's storage and copies a short prompt that tells a new agent to grep it instead of reading it whole.
- Copy a whole message: hovering a Claude message outlines it and shows a copy button that copies its markdown. Your own messages get the same button.

## 0.5.0

- The Agents button shows workflow runs. Each run lists its name, status, duration and agent count, and opens to its agents grouped by phase, with tokens and tool calls. Regular subagents sit in their own Direct agents group. Any agent opens its transcript, and Back returns to the list it came from.
- Sessions without workflows open straight to the subagent list, as before.
- Live sessions show running workflows and their agents as they start.

## 0.4.11

- Fix: 0.4.10 failed to activate (`Cannot find module './impl/format'`), leaving the sessions view empty. The build now fails if the bundled extension cannot load on its own.

## 0.4.10

- Code colors follow the active VS Code color theme, including `editor.tokenColorCustomizations`, and update when the theme changes. The Dark+ and Light+ palette stays as the fallback.
- Code blocks without a language tag get their language guessed from common languages, as the Claude Code terminal does.

## 0.4.9

- Code blocks in messages that name a language are syntax highlighted, in Dark+, Light+ or high contrast colors to match the theme kind. Untagged blocks stay plain.
- Inline code keeps its pill and takes the code variable color.

## 0.4.8

- The usage status bar item sits next to the right edge, so a crowded status bar no longer wraps it out of view.

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
