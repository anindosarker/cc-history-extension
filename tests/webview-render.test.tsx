import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TurnRow } from "@/components/TurnRow";
import { FoldRow } from "@/components/FoldRow";
import { FilesTab } from "@/components/FilesTab";
import { Markdown } from "@/components/Markdown";
import {
  Header,
  OPEN_AT_OPTIONS,
  iconTabsFor,
  menuItems,
  metaLayoutFor,
  titleTooltipLines,
} from "@/components/Header";
import { DEFAULT_FILTERS, SearchBar, filtersActive } from "@/components/SearchBar";
import { nearBottomRight, scrollButtonsFor } from "@/lib/scrollButtons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyFilters, buildRows, findMatches, formatWorkDuration } from "@/lib/search";
import type { Block, FileChange, SessionMeta, Turn } from "@shared/types";

const turns: Turn[] = [
  {
    uuid: "1",
    role: "user",
    kind: "user",
    timestamp: 0,
    blocks: [{ type: "text", text: "Fix **bold** thing\n\n```ts\nconst x = 1;\n```" }],
  },
  {
    uuid: "2",
    role: "assistant",
    kind: "assistant",
    timestamp: 0,
    blocks: [
      { type: "thinking", thinking: "thinking about thing" },
      { type: "text", text: "Sure, thing done. <script>alert(1)</script>" },
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "ls thing" },
        summary: "ls thing",
        result: { text: "a thing\nb", isError: true },
      },
    ],
  },
];

describe("search", () => {
  it("filters blocks and counts matches in render order", () => {
    const visible = applyFilters(turns, { role: "all", showThinking: true, showTools: true });
    const matches = findMatches(visible, "thing");
    // user text 1, thinking 1, text 1, tool chip 1 + input 1 + result 1
    expect(matches).toHaveLength(6);
    expect(matches[1]).toEqual({ turnIndex: 1, blockIndex: 0, occ: 0 });
    const noThinking = applyFilters(turns, { role: "all", showThinking: false, showTools: true });
    expect(findMatches(noThinking, "thing")).toHaveLength(5);
    expect(applyFilters(turns, { role: "user", showThinking: true, showTools: true })).toHaveLength(1);
  });
});

describe("agent and system turns in filters", () => {
  const mixed: Turn[] = [
    { uuid: "1", role: "user", kind: "user", timestamp: 0, blocks: [{ type: "text", text: "do it" }] },
    {
      uuid: "2",
      role: "user",
      kind: "agent",
      agentName: "scripts-agent",
      summary: "done",
      timestamp: 0,
      blocks: [{ type: "text", text: "Finished it" }],
    },
    { uuid: "3", role: "assistant", kind: "assistant", timestamp: 0, blocks: [{ type: "text", text: "Great" }] },
    {
      uuid: "4",
      role: "user",
      kind: "system",
      label: "task notification",
      timestamp: 0,
      blocks: [{ type: "text", text: "<task-notification>finished</task-notification>" }],
    },
  ];

  it("role filter keeps only real user or assistant turns, and the tool toggle hides system turns", () => {
    const kinds = (visible: ReturnType<typeof applyFilters>) => visible.map((v) => v.turn.kind);
    expect(kinds(applyFilters(mixed, { role: "all", showThinking: true, showTools: true }))).toEqual([
      "user",
      "agent",
      "assistant",
      "system",
    ]);
    expect(kinds(applyFilters(mixed, { role: "user", showThinking: true, showTools: true }))).toEqual(["user"]);
    expect(kinds(applyFilters(mixed, { role: "assistant", showThinking: true, showTools: true }))).toEqual(["assistant"]);
    expect(kinds(applyFilters(mixed, { role: "all", showThinking: true, showTools: false }))).toEqual([
      "user",
      "agent",
      "assistant",
    ]);
  });

  it("search still indexes agent and system bodies", () => {
    const all = applyFilters(mixed, { role: "all", showThinking: true, showTools: true });
    expect(findMatches(all, "finished")).toEqual([
      { turnIndex: 1, blockIndex: 0, occ: 0 },
      { turnIndex: 3, blockIndex: 0, occ: 0 },
    ]);
  });

  it("renders an agent card and a system one-liner without bubbles", () => {
    const all = applyFilters(mixed, { role: "all", showThinking: true, showTools: true });
    const html = renderToString(
      <TooltipProvider>
        {all.map((v, i) => (
          <TurnRow key={i} item={v} query="" currentBlock={-1} currentOcc={-1} />
        ))}
      </TooltipProvider>,
    );
    expect(html).toContain("Agent · scripts-agent");
    expect(html).toContain(">done<");
    expect(html).toContain("System · task notification");
    expect((html.match(/chat-bubble/g) ?? []).length).toBe(1);
    // Collapsed bodies stay out of the DOM.
    expect(html).not.toContain("Finished it");
  });
});

describe("recap and notice turns", () => {
  const withRecords: Turn[] = [
    { uuid: "1", role: "user", kind: "user", timestamp: 1_700_000_000_000, blocks: [{ type: "text", text: "go" }] },
    {
      uuid: "2",
      role: "user",
      kind: "recap",
      subtype: "away_summary",
      timestamp: 1_700_000_060_000,
      blocks: [{ type: "text", text: "Goal: finish the **viewer**. Next: file links." }],
    },
    {
      uuid: "3",
      role: "user",
      kind: "notice",
      subtype: "informational",
      timestamp: 1_700_000_120_000,
      blocks: [{ type: "text", text: "Usage limit reached · continuing automatically at 7:50pm" }],
    },
    { uuid: "4", role: "assistant", kind: "assistant", timestamp: 1_700_000_180_000, blocks: [{ type: "text", text: "Done" }] },
  ];
  const all = { role: "all" as const, showThinking: true, showTools: true };

  it("keeps the recap under every filter and hides notices with the tool toggle", () => {
    const kinds = (visible: ReturnType<typeof applyFilters>) => visible.map((v) => v.turn.kind);
    expect(kinds(applyFilters(withRecords, all))).toEqual(["user", "recap", "notice", "assistant"]);
    expect(kinds(applyFilters(withRecords, { ...all, showTools: false }))).toEqual(["user", "recap", "assistant"]);
    expect(kinds(applyFilters(withRecords, { ...all, role: "user" }))).toEqual(["user", "recap"]);
    expect(kinds(applyFilters(withRecords, { ...all, role: "assistant" }))).toEqual(["recap", "assistant"]);
  });

  it("searches recap text and renders a card; a notice renders as a centered divider", () => {
    const visible = applyFilters(withRecords, all);
    expect(findMatches(visible, "viewer")).toEqual([{ turnIndex: 1, blockIndex: 0, occ: 0 }]);
    expect(findMatches(visible, "usage limit")).toEqual([{ turnIndex: 2, blockIndex: 0, occ: 0 }]);
    // Neither one is folded into a work run.
    expect(buildRows(visible, [], new Map()).rows.map((r) => r.kind)).toEqual(["turn", "turn", "turn", "turn"]);
    const html = renderToString(
      <TooltipProvider>
        {visible.map((v, i) => (
          <TurnRow key={i} item={v} query="viewer" currentBlock={i === 1 ? 0 : -1} currentOcc={i === 1 ? 0 : -1} />
        ))}
      </TooltipProvider>,
    );
    const recap = html.slice(html.indexOf('data-turn-index="1"'), html.indexOf('data-turn-index="2"'));
    expect(recap).toContain("recap-card");
    expect(recap).toContain(">RECAP<");
    expect(recap).toMatch(/title="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 \d\d:\d\d:\d\d"[^>]*>\d\d:\d\d</);
    expect(recap).toContain("<strong>");
    expect(recap).toContain('<mark data-current="true">viewer</mark>');
    expect(recap).not.toContain("chat-bubble");
    expect(recap).not.toContain("tier-2");
    // The row's class list comes before its data attribute, so start the slice at the row's opening tag.
    const notice = html.slice(html.lastIndexOf("<div", html.indexOf('data-turn-index="2"')), html.indexOf('data-turn-index="3"'));
    expect(notice).toContain("notice-row");
    expect(notice).toContain("fold-rule");
    expect(notice).toContain("Usage limit reached · continuing automatically at 7:50pm");
    expect(notice).toContain("tier-2");
    expect(notice).not.toContain("chat-bubble");
  });
});

describe("file links", () => {
  it("marks inline code paths as links in markdown, leaving URLs and fenced code alone", () => {
    const html = renderToString(
      <Markdown
        text={"See `src/parser.ts:12:4` and `/abs/a.ts` and `~/x.json`, not `https://x.com/a.ts`, `npm run x`, `a/b` or `0.1.0`.\n\n```\nsrc/fenced.ts\n```"}
        query=""
      />,
    );
    expect(html).toMatch(/<code[^>]*data-file-path="src\/parser.ts"[^>]*data-line="12"[^>]*data-column="4"[^>]*>src\/parser.ts:12:4<\/code>/);
    expect(html).toMatch(/<code data-file-path="\/abs\/a.ts" class="file-link" role="link" tabindex="0" title="Open \/abs\/a.ts">/);
    expect(html).toContain('data-file-path="~/x.json"');
    expect((html.match(/data-file-path=/g) ?? []).length).toBe(3);
    expect(html).toMatch(/<code>https:\/\/x.com\/a.ts<\/code>/);
    expect(html).toMatch(/<code>npm run x<\/code>/);
    expect(html).toMatch(/<code>a\/b<\/code>/);
    expect(html).toMatch(/<code>0.1.0<\/code>/);
    expect(html).toMatch(/<pre><code>src\/fenced.ts\n<\/code><\/pre>/);
    // Search marks still land inside a linked span.
    const marked = renderToString(<Markdown text="Open `src/parser.ts:12`" query="parser" current={0} />);
    expect(marked).toMatch(/data-file-path="src\/parser.ts"[^>]*>src\/<mark data-current="true">parser<\/mark>.ts:12<\/code>/);
  });

  it("links the file in Read, Edit and Write tool lines but not in Bash lines", () => {
    const file = (name: string, p: string): Block => ({
      type: "tool_use",
      id: name + p,
      name,
      input: { file_path: p },
      summary: p,
      result: { text: "ok", isError: false },
    });
    const turn: Turn = {
      uuid: "t",
      role: "assistant",
      kind: "assistant",
      timestamp: 0,
      blocks: [
        file("Read", "/a/b.ts"),
        file("Edit", "src/c.ts"),
        file("Write", "~/d.md"),
        { type: "tool_use", id: "x", name: "Bash", input: { command: "cat src/e.ts" }, summary: "cat src/e.ts", result: { text: "", isError: false } },
      ],
    };
    const visible = applyFilters([turn], { role: "all", showThinking: true, showTools: true });
    const html = renderToString(
      <TooltipProvider>
        <TurnRow item={visible[0]} query="" currentBlock={-1} currentOcc={-1} />
      </TooltipProvider>,
    );
    expect((html.match(/tool-file/g) ?? []).length).toBe(3);
    expect(html).toMatch(/tool-file[^>]*title="Open \/a\/b.ts"[^>]*>\/a\/b.ts<\/button>/);
    expect(html).toMatch(/tool-file[^>]*title="Open src\/c.ts"/);
    expect(html).toMatch(/tool-file[^>]*title="Open ~\/d.md"/);
    // The Bash summary stays inside the trigger as plain text.
    expect(html).toMatch(/<span class="min-w-0 truncate tier-3">cat src\/e.ts<\/span>/);
  });
});

describe("work folds", () => {
  const MIN = 60_000;
  const tool = (id: string, cmd: string): Block => ({
    type: "tool_use",
    id,
    name: "Bash",
    input: { command: cmd },
    summary: cmd,
    result: { text: "ok", isError: false },
  });
  const work = (uuid: string, timestamp: number, ...blocks: Block[]): Turn => ({
    uuid,
    role: "assistant",
    kind: "assistant",
    timestamp,
    blocks,
  });
  const session: Turn[] = [
    { uuid: "u1", role: "user", kind: "user", timestamp: 0, blocks: [{ type: "text", text: "fix it" }] },
    work("w1", 1 * MIN, { type: "thinking", thinking: "look first" }, tool("t1", "grep needle src")),
    work("w2", 3 * MIN, tool("t2", "cat a.ts"), tool("t3", "cat b.ts")),
    work("w3", 5 * MIN, tool("t4", "sed -i s/a/b/ a.ts")),
    work("a1", 6 * MIN, { type: "text", text: "Done." }),
    { uuid: "u2", role: "user", kind: "user", timestamp: 7 * MIN, blocks: [{ type: "text", text: "and tests?" }] },
    work("w4", 7 * MIN + 42_000, tool("t5", "pnpm test")),
  ];
  const all = { role: "all" as const, showThinking: true, showTools: true };

  it("groups each run of tool-only assistant turns into one fold with counts and durations", () => {
    const visible = applyFilters(session, all);
    const { rows, rowOf } = buildRows(visible, [], new Map());
    expect(rows.map((r) => r.kind)).toEqual(["turn", "fold", "turn", "turn", "fold"]);
    const first = rows[1];
    const second = rows[4];
    if (first.kind !== "fold" || second.kind !== "fold") throw new Error("expected folds");
    expect(first.items.map((v) => v.turn.uuid)).toEqual(["w1", "w2", "w3"]);
    expect(first.toolCalls).toBe(4);
    // Measured from the first folded turn to the text turn that follows the run.
    expect(first.durationMs).toBe(5 * MIN);
    expect(first.open).toBe(false);
    expect(second.items.map((v) => v.turn.uuid)).toEqual(["w4"]);
    expect(second.toolCalls).toBe(1);
    // Nothing follows the last run, so first-to-last is all there is.
    expect(second.durationMs).toBe(0);
    // Every visible turn maps back to the row that shows it.
    expect(rowOf).toEqual([0, 1, 1, 1, 2, 3, 4]);
    expect(formatWorkDuration(first.durationMs)).toBe("5m");
    expect(formatWorkDuration(42_000)).toBe("42s");
    expect(formatWorkDuration(65 * MIN)).toBe("1h 5m");
  });

  it("opens a fold when a search hit lives inside it and counts the hit", () => {
    const visible = applyFilters(session, all);
    const matches = findMatches(visible, "look first");
    expect(matches).toEqual([{ turnIndex: 1, blockIndex: 0, occ: 0 }]);
    const { rows } = buildRows(visible, matches, new Map());
    const fold = rows[1];
    if (fold.kind !== "fold") throw new Error("expected a fold");
    expect(fold.hasMatch).toBe(true);
    expect(fold.open).toBe(true);
    // An explicit choice wins over the search default, and the other fold stays shut.
    expect(buildRows(visible, matches, new Map([[fold.key, false]])).rows[1]).toMatchObject({ open: false });
    expect(rows[4]).toMatchObject({ kind: "fold", hasMatch: false, open: false });
  });

  it("puts a date divider where the calendar day changes, outside the match count", () => {
    const day = 24 * 60 * MIN;
    const base = Date.UTC(2026, 8, 29, 12); // noon, so local days stay distinct around it
    const twoDays: Turn[] = [
      { ...session[0], timestamp: base },
      { ...session[1], timestamp: base + 1 * MIN },
      { ...session[4], timestamp: base + 2 * MIN },
      { ...session[5], timestamp: base + day },
      { ...session[6], timestamp: base + day + 1 * MIN },
    ];
    const visible = applyFilters(twoDays, all);
    const matches = findMatches(visible, "Done");
    const { rows, rowOf } = buildRows(visible, matches, new Map());
    expect(rows.map((r) => r.kind)).toEqual(["turn", "fold", "turn", "date", "turn", "fold"]);
    const divider = rows[3];
    if (divider.kind !== "date") throw new Error("expected a date row");
    expect(divider.label).toMatch(/^(Tue|Wed), Sep 30$/);
    // Dividers take a row slot but no visible index, so matches and rowOf still line up.
    expect(rowOf).toEqual([0, 1, 2, 4, 5]);
    expect(matches).toHaveLength(1);
    expect(visible).toHaveLength(5);
    // Same-day turns get no divider at all.
    expect(buildRows(applyFilters(session, all), [], new Map()).rows.some((r) => r.kind === "date")).toBe(false);
  });

  it("hides folds with the tool toggle and keeps them under the assistant role filter", () => {
    const noTools = applyFilters(session, { ...all, showTools: false });
    expect(noTools.map((v) => v.turn.uuid)).toEqual(["u1", "a1", "u2"]);
    expect(buildRows(noTools, [], new Map()).rows.every((r) => r.kind === "turn")).toBe(true);
    const assistant = applyFilters(session, { ...all, role: "assistant" });
    expect(buildRows(assistant, [], new Map()).rows.map((r) => r.kind)).toEqual(["fold", "turn", "fold"]);
  });

  it("renders the fold line, and the folded turns only once open", () => {
    const visible = applyFilters(session, all);
    const { rows } = buildRows(visible, [], new Map());
    const fold = rows[1];
    if (fold.kind !== "fold") throw new Error("expected a fold");
    const closed = renderToString(
      <TooltipProvider>
        <FoldRow row={fold} query="" current={undefined} onToggle={() => {}} />
      </TooltipProvider>,
    );
    expect(closed).toContain("Worked for 5m");
    expect(closed).toContain(">4 tool calls<");
    // The left side carries only the chevron and the duration; counts sit at the right end.
    expect(closed).not.toContain("· 4 tool calls");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("tool-line");
    expect(closed).toContain(">Expand all<");
    const open = renderToString(
      <TooltipProvider>
        <FoldRow row={{ ...fold, open: true }} query="" current={undefined} onToggle={() => {}} />
      </TooltipProvider>,
    );
    expect(open).toContain('aria-expanded="true"');
    expect((open.match(/tool-line/g) ?? []).length).toBe(4);
    expect(open).toContain("Used <!-- -->Bash");
    expect(open).toContain("Thinking…");
    const single = rows[4];
    if (single.kind !== "fold") throw new Error("expected a fold");
    const html = renderToString(
      <TooltipProvider>
        <FoldRow row={single} query="" current={undefined} onToggle={() => {}} />
      </TooltipProvider>,
    );
    expect(html).toContain("Worked for 0s");
    expect(html).toContain(">1 tool call<");
  });
});

describe("image blocks", () => {
  const withImages: Turn[] = [
    {
      uuid: "img",
      role: "user",
      kind: "user",
      timestamp: 1_700_000_000_000,
      blocks: [
        { type: "text", text: "What is this?" },
        { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
        { type: "image", omitted: true, bytes: 4_200_000 },
      ],
    },
  ];

  it("renders a thumbnail and an omitted note inside the user bubble, and never searches them", () => {
    const visible = applyFilters(withImages, { role: "all", showThinking: true, showTools: true });
    expect(findMatches(visible, "image")).toHaveLength(0);
    const html = renderToString(
      <TooltipProvider>
        <TurnRow item={visible[0]} query="" currentBlock={-1} currentOcc={-1} />
      </TooltipProvider>,
    );
    const bubble = html.slice(html.indexOf("chat-bubble"));
    expect(bubble).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(bubble).toContain("max-h-[240px]");
    expect(bubble).toContain("rounded-[8px]");
    expect(bubble).toContain("Image omitted (4.2 MB)");
    // The clock carries the full date as a tooltip.
    expect(bubble).toMatch(/title="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 \d\d:\d\d:\d\d"/);
  });
});

describe("webview components render on the server", () => {
  it("renders turns with markdown, escaped html and a single current mark", () => {
    const visible = applyFilters(turns, { role: "all", showThinking: true, showTools: true });
    const cur = findMatches(visible, "thing")[2];
    const html = renderToString(
      <TooltipProvider>
        {visible.map((v, i) => (
          <TurnRow
            key={i}
            item={v}
            query="thing"
            currentBlock={cur.turnIndex === i ? cur.blockIndex : -1}
            currentOcc={cur.turnIndex === i ? cur.occ : -1}
          />
        ))}
      </TooltipProvider>,
    );
    expect(html).toContain("<strong>");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<script>");
    // Two text blocks plus the always-visible tool chip summary; collapsed bodies are not in the DOM.
    expect((html.match(/<mark/g) ?? []).length).toBe(3);
    expect((html.match(/data-current="true"/g) ?? []).length).toBe(1);
  });

  it("renders quiet turns: user bubble, hover-only assistant stamp, no index badges", () => {
    const stamped = turns.map((t) => ({ ...t, timestamp: 1_700_000_000_000 }));
    const visible = applyFilters(stamped, { role: "all", showThinking: true, showTools: true });
    const html = renderToString(
      <TooltipProvider>
        {visible.map((v, i) => (
          <TurnRow key={i} item={v} query="" currentBlock={-1} currentOcc={-1} />
        ))}
      </TooltipProvider>,
    );
    expect(html).toContain('data-turn-index="0"');
    expect(html).toContain('data-turn-index="1"');
    expect(html).toContain("chat-bubble");
    // The timestamp sits inside the bubble and is always visible.
    const bubble = html.slice(html.indexOf("chat-bubble"), html.indexOf('data-turn-index="1"'));
    expect(bubble).toMatch(/text-right[^>]*>\d\d:\d\d<\/div><\/div><\/div><\/div>/);
    expect(html).toContain("tool-line");
    // Plain "Used <tool>" line, no outlined pill, and the error result is a small "failed".
    expect(html).toContain("Used <!-- -->Bash");
    expect(html).toContain(">failed<");
    expect(html).not.toContain("tool-pill");
    expect(html).toContain("Thinking…");
    // No "Claude · HH:MM" meta line; the assistant time is a hover-only stamp with the full date as tooltip.
    expect(html).not.toContain("Claude · ");
    const assistant = html.slice(html.indexOf('data-turn-index="1"'));
    expect(assistant).toMatch(/turn-time[^>]*title="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 \d\d:\d\d:\d\d"[^>]*>\d\d:\d\d<\/span>/);
    // Two tiers: the content column wraps every row, content is primary, tool and thinking lines secondary.
    expect((assistant.match(/chat-content/g) ?? []).length).toBe(1);
    expect(assistant).toContain("tier-1");
    expect((assistant.match(/tier-2/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/>#\d+</);
    expect(html).not.toContain("border-l-");
  });

  it("renders the header in two rows, the files tab and the search bar", () => {
    const files: FileChange[] = [
      { path: "/a/b/c.ts", hunks: [{ tool: "Edit", before: "x", after: "y\nz", added: 2, removed: 1 }], added: 2, removed: 1, partial: true },
    ];
    const meta: SessionMeta = {
      sessionId: "sess",
      filePath: "/f.jsonl",
      cwd: "/a/b",
      projectName: "b",
      title: "Title",
      titleSource: "ai",
      messageCount: 2,
      filesChanged: 1,
      mtime: 0,
      size: 0,
      startedAt: 1_700_000_000_000,
      lastActivityAt: 1_700_000_900_000,
      gitBranch: "main",
    };
    const html = renderToString(
      <TooltipProvider>
        <Header
          meta={meta}
          turnCount={2}
          openAt="newest"
          onOpenAtChange={() => {}}
          tab="messages"
          onTabChange={() => {}}
          filesCount={1}
          width={1000}
          search={<span>SEARCH-SLOT</span>}
        />
        <FilesTab files={files} />
        <SearchBar
          query="q"
          onQueryChange={() => {}}
          matchCount={3}
          current={1}
          onNext={() => {}}
          onPrev={() => {}}
          filters={{ role: "all", showThinking: true, showTools: false }}
          onFiltersChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(html).toContain("c.ts");
    expect(html).toContain("partial");
    // Row 1: title with the full tooltip, inline meta, icon-only Resume, "..." menu trigger.
    const h1 = html.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(h1).toContain("text-[16px]");
    expect(h1).toMatch(/title="Title\nb\n2023-11-1[45] \d\d:\d\d\n15m\nmain\nsess"/);
    expect(html).toMatch(/header-meta[^>]*>b · 2023-11-1[45] \d\d:\d\d · 2 messages</);
    expect(html).toContain('aria-label="Resume"');
    expect(html).toContain('aria-label="More actions"');
    expect(html).not.toContain(">Save as .txt<");
    expect(html).not.toContain('aria-pressed="true"');
    // Row 2: text tabs and the search slot.
    expect(html).toContain(">Messages</button>");
    expect(html).toContain(">Files changed (1)</button>");
    expect(html).toContain("SEARCH-SLOT");
    // The counter and nav live inside the input's right end; the filters icon shows a dot.
    expect(html).toContain("2 / 3");
    expect(html).toMatch(/search-tools[^>]*>.*2 \/ 3.*aria-label="Previous match".*aria-label="Next match".*aria-label="Clear search"/s);
    expect(html).toMatch(/filters-button[^>]*data-active="true"/);
    expect(html).toContain("filters-dot");
  });

  it("drops the inline meta and turns tabs into icons as the header narrows", () => {
    const meta: SessionMeta = {
      sessionId: "sess",
      filePath: "/f.jsonl",
      cwd: "/a/b",
      projectName: "b",
      title: "Title",
      titleSource: "ai",
      messageCount: 7,
      filesChanged: 0,
      mtime: 0,
      size: 0,
      startedAt: 1_700_000_000_000,
    };
    const render = (width: number) =>
      renderToString(
        <TooltipProvider>
          <Header
            meta={meta}
            turnCount={7}
            openAt="oldest"
            onOpenAtChange={() => {}}
            tab="files"
            onTabChange={() => {}}
            filesCount={3}
            width={width}
          />
        </TooltipProvider>,
      );
    expect(metaLayoutFor(undefined)).toBe("full");
    expect(metaLayoutFor(760)).toBe("full");
    expect(metaLayoutFor(759)).toBe("short");
    expect(metaLayoutFor(520)).toBe("short");
    expect(metaLayoutFor(519)).toBe("none");
    expect(iconTabsFor(420)).toBe(false);
    expect(iconTabsFor(419)).toBe(true);
    const mid = render(600);
    expect(mid).toMatch(/header-meta[^>]*>7 messages</);
    expect(mid).toContain(">Messages</button>");
    const narrow = render(400);
    expect(narrow).not.toContain("header-meta");
    expect(narrow).not.toContain(">Messages</button>");
    expect(narrow).toMatch(/title="Messages"[^>]*>.*<span class="tabular-nums">7<\/span>/);
    expect(narrow).toMatch(/title="Files changed"[^>]*>.*<span class="tabular-nums">3<\/span>/);
    // The search slot is kept in the layout but hidden while the Files tab is active.
    expect(narrow).toContain("invisible");
  });

  it("lists the menu items with the Open at radio pair and Show usage", () => {
    const meta: SessionMeta = {
      sessionId: "sess",
      filePath: "/f.jsonl",
      cwd: "/a/b",
      projectName: "b",
      title: "Title",
      titleSource: "ai",
      messageCount: 0,
      filesChanged: 0,
      mtime: 0,
      size: 0,
    };
    const items = menuItems(meta);
    expect(items.before.map((i) => i.label)).toEqual(["Save as .txt", "Copy transcript", "Reveal JSONL", "Copy session ID"]);
    expect(items.after.map((i) => i.label)).toEqual(["Show usage"]);
    expect(OPEN_AT_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["oldest", "Oldest"],
      ["newest", "Newest"],
    ]);
    expect(titleTooltipLines(meta)).toEqual(["Title", "b", "sess"]);
  });

  it("marks the filters icon only when a filter is off its default", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive({ role: "all", showThinking: true, showTools: true })).toBe(false);
    expect(filtersActive({ role: "user", showThinking: true, showTools: true })).toBe(true);
    expect(filtersActive({ role: "all", showThinking: false, showTools: true })).toBe(true);
    expect(filtersActive({ role: "all", showThinking: true, showTools: false })).toBe(true);
    const plain = renderToString(
      <TooltipProvider>
        <SearchBar
          query=""
          onQueryChange={() => {}}
          matchCount={0}
          current={0}
          onNext={() => {}}
          onPrev={() => {}}
          filters={DEFAULT_FILTERS}
          onFiltersChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(plain).toMatch(/filters-button[^>]*data-active="false"/);
    expect(plain).not.toContain("filters-dot");
    // No query, no counter or nav inside the input.
    expect(plain).not.toContain("search-tools");
  });

  it("decides which scroll buttons to show from the scroll geometry", () => {
    // Fits: nothing.
    expect(scrollButtonsFor(0, 500, 600)).toEqual({ up: false, down: false });
    expect(scrollButtonsFor(0, 600, 600)).toEqual({ up: false, down: false });
    // At the top: only down.
    expect(scrollButtonsFor(0, 2000, 600)).toEqual({ up: false, down: true });
    expect(scrollButtonsFor(1, 2000, 600)).toEqual({ up: false, down: true });
    // In between: both.
    expect(scrollButtonsFor(700, 2000, 600)).toEqual({ up: true, down: true });
    // At the end (allowing a fractional shortfall): only up.
    expect(scrollButtonsFor(1400, 2000, 600)).toEqual({ up: true, down: false });
    expect(scrollButtonsFor(1398.5, 2000, 600)).toEqual({ up: true, down: false });
    // Pointer near the bottom-right corner of the viewport.
    const rect = { right: 1000, bottom: 800 };
    expect(nearBottomRight(990, 790, rect)).toBe(true);
    expect(nearBottomRight(904, 704, rect)).toBe(true);
    expect(nearBottomRight(900, 790, rect)).toBe(false);
    expect(nearBottomRight(990, 700, rect)).toBe(false);
  });

  it("truncates a long title and keeps the full text in a title attribute", () => {
    const title = "Mouse wheel zoom setting investigation and follow-up fixes";
    expect(title.length).toBeGreaterThanOrEqual(60);
    const meta: SessionMeta = {
      sessionId: "sess",
      filePath: "/f.jsonl",
      cwd: "/a/b",
      projectName: "b",
      title,
      titleSource: "ai",
      messageCount: 2,
      filesChanged: 0,
      mtime: 0,
      size: 0,
    };
    const html = renderToString(
      <TooltipProvider>
        <Header
          meta={meta}
          turnCount={2}
          openAt="oldest"
          onOpenAtChange={() => {}}
          tab="messages"
          onTabChange={() => {}}
          filesCount={0}
        />
      </TooltipProvider>,
    );
    const h1 = html.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(h1).toContain("truncate");
    expect(h1).toContain("min-w-0");
    expect(h1).toContain(`title="${title}\nb\nsess"`);
    expect(html).toContain(`>${title}</h1>`);
  });
});
