import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TurnRow } from "@/components/TurnRow";
import { FoldRow } from "@/components/FoldRow";
import { FilesTab } from "@/components/FilesTab";
import { Header } from "@/components/Header";
import { SearchBar } from "@/components/SearchBar";
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
    expect(first.durationMs).toBe(4 * MIN);
    expect(first.open).toBe(false);
    expect(second.items.map((v) => v.turn.uuid)).toEqual(["w4"]);
    expect(second.toolCalls).toBe(1);
    expect(second.durationMs).toBe(0);
    // Every visible turn maps back to the row that shows it.
    expect(rowOf).toEqual([0, 1, 1, 1, 2, 3, 4]);
    expect(formatWorkDuration(first.durationMs)).toBe("4m");
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
    expect(closed).toContain("Worked for 4m");
    expect(closed).toContain("· 4 tool calls");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("tool-pill");
    const open = renderToString(
      <TooltipProvider>
        <FoldRow row={{ ...fold, open: true }} query="" current={undefined} onToggle={() => {}} />
      </TooltipProvider>,
    );
    expect(open).toContain('aria-expanded="true"');
    expect((open.match(/tool-pill/g) ?? []).length).toBe(4);
    expect(open).toContain("Thinking…");
    const single = rows[4];
    if (single.kind !== "fold") throw new Error("expected a fold");
    const html = renderToString(
      <TooltipProvider>
        <FoldRow row={single} query="" current={undefined} onToggle={() => {}} />
      </TooltipProvider>,
    );
    expect(html).toContain("Worked for 0s");
    expect(html).toContain("· 1 tool call<");
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

  it("renders quiet turns: user bubble, assistant meta line, no index badges", () => {
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
    expect(bubble).toMatch(/text-right[^>]*>\d\d:\d\d<\/div><\/div><\/div>/);
    expect(html).not.toContain("group-hover:opacity-100");
    expect(html).toContain("tool-pill");
    expect(html).toContain("Thinking…");
    expect(html).toMatch(/>Claude · \d\d:\d\d</);
    expect(html).not.toMatch(/>#\d+</);
    expect(html).not.toContain("border-l-");
  });

  it("renders the header, files tab and search bar", () => {
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
        <Header meta={meta} turnCount={2} openAt="newest" onOpenAtChange={() => {}} />
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
    expect(html).toContain("2 / 3");
    expect(html).toContain("15m");
    expect(html).toContain("main");
    // The Old | New toggle marks the persisted choice as pressed.
    expect(html).toMatch(/aria-pressed="true"[^>]*>New</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Old</);
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
        <Header meta={meta} turnCount={2} openAt="oldest" onOpenAtChange={() => {}} />
      </TooltipProvider>,
    );
    const h1 = html.match(/<h1[^>]*>/)?.[0] ?? "";
    expect(h1).toContain("truncate");
    expect(h1).toContain("min-w-0");
    expect(h1).toContain(`title="${title}"`);
    expect(html).toContain(`>${title}</h1>`);
  });
});
