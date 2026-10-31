import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TurnRow } from "@/components/TurnRow";
import { FoldRow } from "@/components/FoldRow";
import { FilesTab } from "@/components/FilesTab";
import { Markdown } from "@/components/Markdown";
import {
  Header,
  OPEN_AT_OPTIONS,
  folderActions,
  iconTabsFor,
  menuItems,
  metaLayoutFor,
  titleTooltipLines,
} from "@/components/Header";
import { DEFAULT_FILTERS, SearchBar, filtersActive } from "@/components/SearchBar";
import { nearBottomRight, scrollButtonsFor } from "@/lib/scrollButtons";
import { displayToolName } from "@shared/toolSummary";
import { editCounts, editLines } from "@shared/editStats";
import { runStatus, toolStatus } from "@/lib/toolStatus";
import { AgentsContext } from "@/lib/agents";
import {
  AgentRowLabel,
  AgentsMenu,
  StatusIcon,
  agentTotal,
  agentsSummary,
  phaseGroups,
  runIconStatus,
  runRowDetail,
  runSummaryLine,
} from "@/components/AgentsButton";
import { ToolUseBlock } from "@/components/ToolUseBlock";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyFilters, buildRows, findMatches, formatWorkDuration } from "@/lib/search";
import { applyThemeTokens } from "@/lib/themeTokens";
import type { Block, FileChange, SessionMeta, SubagentInfo, Turn, WorkflowRun } from "@shared/types";

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
    // The card leads with the agent's name, as Claude Code's own agent list does; no "Agent ·" prefix, no badge.
    expect(html).toMatch(/agent-card-head[^>]*><span class="agent-name shrink-0 font-medium">scripts-agent<\/span>/);
    expect(html).not.toContain("Agent · ");
    expect(html).toContain("agent-card");
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
    expect(recap).toMatch(/aria-label="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 · [\d:]+( [AP]M)?"[^>]*>\d{1,2}:\d{2}( [AP]M)?</);
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

describe("code highlighting", () => {
  it("colors tagged fenced blocks and guesses the language of untagged ones", () => {
    const tagged = renderToString(<Markdown text={"```ts\nconst x: number = 1;\n```"} query="" />);
    expect(tagged).toContain('class="hljs language-ts"');
    expect(tagged).toMatch(/<span class="hljs-keyword">const<\/span>/);
    const untagged = renderToString(
      <Markdown text={"```\nfunction find(list) {\n  return list.indexOf(\"x\");\n}\n```"} query="" />,
    );
    expect(untagged).toContain('<code class="hljs language-javascript">');
    expect(untagged).toMatch(/<span class="hljs-keyword">return<\/span>/);
    // Inline code is never highlighted.
    expect(renderToString(<Markdown text="Run `const x = 1`" query="" />)).toContain("<code>const x = 1</code>");
  });

  it("still marks search hits inside highlighted tokens", () => {
    const html = renderToString(<Markdown text={"```ts\nconst value = \"needle\";\n```"} query="needle" current={0} />);
    expect(html).toMatch(/<span class="hljs-string">&quot;<mark data-current="true">needle<\/mark>&quot;<\/span>/);
  });

  it("still marks search hits in untagged blocks after detection", () => {
    const text = "```\nfunction find(list) {\n  return list.indexOf(\"needle\");\n}\n```";
    const html = renderToString(<Markdown text={text} query="needle" current={0} />);
    expect(html).toMatch(/<code class="hljs language-[\w-]+">/);
    expect(html).toContain('<mark data-current="true">needle</mark>');
  });

  it("sets theme token vars from the host and clears the ones it no longer sends", () => {
    const vars = new Map<string, string>();
    const style = {
      setProperty: (k: string, v: string | null) => void vars.set(k, v ?? ""),
      removeProperty: (k: string) => {
        vars.delete(k);
        return "";
      },
    };
    applyThemeTokens(style, { keyword: "#ff0000", string: "#00ff00" });
    expect(Object.fromEntries(vars)).toEqual({ "--tok-keyword": "#ff0000", "--tok-string": "#00ff00" });
    applyThemeTokens(style, { comment: "#888888" });
    expect(Object.fromEntries(vars)).toEqual({ "--tok-comment": "#888888" });
    applyThemeTokens(style, {});
    expect(vars.size).toBe(0);
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
    // Fenced code may get a guessed language class but never a file link.
    expect(html).toMatch(/<pre><code[^>]*>src\/fenced.ts\n<\/code><\/pre>/);
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
    // The path is wrapped in left-to-right marks so its right-to-left clipping keeps the slashes in place.
    expect(html).toMatch(/tool-file[^>]*title="Open \/a\/b.ts"[^>]*>\u200e<!-- -->\/a\/b.ts<!-- -->\u200e<\/button>/);
    expect(html).toMatch(/tool-file[^>]*title="Open src\/c.ts"/);
    expect(html).toMatch(/tool-file[^>]*title="Open ~\/d.md"/);
    // The Bash summary stays inside the trigger as plain text.
    expect(html).toMatch(/<span class="min-w-0 flex-1 basis-0 truncate tool-bash">cat src\/e.ts<\/span>/);
  });

  it("truncates long tool names, shortens MCP names, and stacks the path under the trigger when narrow", () => {
    const mcp: Block = {
      type: "tool_use",
      id: "m",
      name: "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
      input: { commands: [] },
      summary: "run three commands",
      result: { text: "ok", isError: false },
    };
    const write: Block = {
      type: "tool_use",
      id: "w",
      name: "Write",
      input: { file_path: "/Users/me/Work/Personal/project/src/webview/components/ToolUseBlock.tsx" },
      summary: "/Users/me/Work/Personal/project/src/webview/components/ToolUseBlock.tsx",
      result: { text: "ok", isError: false },
    };
    const turn: Turn = { uuid: "t", role: "assistant", kind: "assistant", timestamp: 0, blocks: [mcp, write] };
    const visible = applyFilters([turn], { role: "all", showThinking: true, showTools: true });
    const render = (narrow: boolean) =>
      renderToString(
        <TooltipProvider>
          <TurnRow item={visible[0]} query="" currentBlock={-1} currentOcc={-1} narrow={narrow} />
        </TooltipProvider>,
      );
    expect(displayToolName("mcp__plugin_context-mode_context-mode__ctx_batch_execute")).toBe("ctx_batch_execute");
    expect(displayToolName("mcp__GitKraken__git_status")).toBe("git_status");
    expect(displayToolName("Bash")).toBe("Bash");
    expect(displayToolName("mcp__")).toBe("mcp__");

    const wide = render(false);
    // The MCP line shows the short name, keeps the full one in the title and in a hidden span for search marks.
    expect(wide).toMatch(/tool-name min-w-0 truncate" title="mcp__plugin_context-mode_context-mode__ctx_batch_execute">Used <span class="sr-only">mcp__plugin_context-mode_context-mode__<\/span><span class="tool-fn">ctx_batch_execute<\/span><\/span>/);
    // Next to a path button the trigger keeps its own width and the name does not truncate.
    expect(wide).toMatch(/tool-line[^"]*shrink-0"[^>]*title="Write \/Users\/me[^"]*"[^>]*>.*?<span class="tool-name shrink-0">Used <span class="tool-fn">Write<\/span><\/span>/);
    expect(wide).toMatch(/tool-file tool-path min-w-0 max-w-full truncate[^>]*title="Open \/Users\/me\/Work\/Personal\/project\/src\/webview\/components\/ToolUseBlock.tsx"/);
    expect(wide).not.toContain("data-stacked");

    const narrow = render(true);
    // Only the line with a path stacks; the MCP line keeps its single row.
    expect((narrow.match(/data-stacked="true"/g) ?? []).length).toBe(1);
    expect(narrow).toMatch(/<div class="[^"]*flex-col[^"]*" data-stacked="true">/);
    expect(narrow).toMatch(/tool-name min-w-0 truncate"[^>]*>Used <span class="sr-only">/);
  });
});

describe("colour accents", () => {
  const tool = (
    id: string,
    name: string,
    input: unknown,
    result?: { text: string; isError: boolean },
  ): Extract<Block, { type: "tool_use" }> => ({
    type: "tool_use",
    id,
    name,
    input,
    summary: (input as { file_path?: string; command?: string }).file_path ?? (input as { command?: string }).command ?? name,
    ...(result ? { result } : {}),
  });
  const all = { role: "all" as const, showThinking: true, showTools: true };
  const render = (blocks: Block[], openAll?: { open: boolean; seq: number }) => {
    const turn: Turn = { uuid: "c", role: "assistant", kind: "assistant", timestamp: 0, blocks };
    const visible = applyFilters([turn], all);
    return renderToString(
      <TooltipProvider>
        <TurnRow item={visible[0]} query="" currentBlock={-1} currentOcc={-1} openAll={openAll} />
      </TooltipProvider>,
    );
  };

  it("puts a status dot before the tool name: green, red, grey, purple for agents", () => {
    const html = render([
      tool("ok", "Bash", { command: "ls" }, { text: "a", isError: false }),
      tool("err", "Bash", { command: "ls" }, { text: "boom", isError: true }),
      tool("none", "Bash", { command: "ls" }),
      tool("agent", "Agent", { description: "x" }, { text: "spawned", isError: false }),
    ]);
    expect(html.match(/tool-dot" data-status="([a-z]+)"/g)).toEqual([
      'tool-dot" data-status="ok"',
      'tool-dot" data-status="error"',
      'tool-dot" data-status="none"',
      'tool-dot" data-status="agent"',
    ]);
    expect(toolStatus(tool("x", "Bash", {}, { text: "", isError: false }))).toBe("ok");
    expect(toolStatus(tool("x", "Bash", {}, { text: "", isError: true }))).toBe("error");
    expect(toolStatus(tool("x", "Bash", {}))).toBe("none");
    // Bash summaries take the terminal yellow; the name takes the symbol colour.
    expect(html).toContain('<span class="tool-fn">Bash</span>');
    expect(html).toContain('truncate tool-bash">ls</span>');
  });

  it("computes +N −M for an Edit and +N for a Write, matching the Files tab hunk math", () => {
    expect(editCounts("Edit", { file_path: "/a.ts", old_string: "a\nb\n", new_string: "a\nb\nc\nd" })).toEqual({ added: 4, removed: 2 });
    expect(editCounts("Edit", { file_path: "/a.ts", old_string: "", new_string: "x" })).toEqual({ added: 1, removed: 0 });
    expect(editCounts("MultiEdit", { file_path: "/a.ts", edits: [{ old_string: "a", new_string: "b\nc" }, { old_string: "d\ne", new_string: "" }] })).toEqual({ added: 2, removed: 3 });
    expect(editCounts("Write", { file_path: "/a.ts", content: "one\ntwo\nthree\n" })).toEqual({ added: 3 });
    expect(editCounts("NotebookEdit", { notebook_path: "/n.ipynb", new_source: "x" })).toEqual({ added: 1 });
    expect(editCounts("Bash", { command: "ls" })).toBeUndefined();
    expect(editCounts("Read", { file_path: "/a.ts" })).toBeUndefined();
    const html = render([
      tool("e", "Edit", { file_path: "/a.ts", old_string: "a\nb\n", new_string: "a\nb\nc\nd" }, { text: "ok", isError: false }),
      tool("w", "Write", { file_path: "/b.ts", content: "one\ntwo\nthree\n" }, { text: "ok", isError: false }),
    ]);
    // The counts are Badge pills in the added and removed variants.
    expect(html).toMatch(/<span class="[^"]*text-added[^"]*">\+4<\/span><span class="[^"]*text-removed[^"]*">−2<\/span>/);
    expect(html).toMatch(/<span class="[^"]*text-added[^"]*">\+3<\/span><\/span>/);
  });

  it("shows an expanded Edit as a mini diff and a Write as added lines, other tools keep their JSON", () => {
    const html = render(
      [
        tool("e", "Edit", { file_path: "/a.ts", old_string: "old line\n", new_string: "new line\nmore\n" }, { text: "ok", isError: false }),
        tool("w", "Write", { file_path: "/b.ts", content: "w1\nw2" }, { text: "ok", isError: false }),
        tool("b", "Bash", { command: "ls -la" }, { text: "out", isError: false }),
      ],
      { open: true, seq: 1 },
    );
    expect(html).toContain('<div class="line" data-kind="del">- old line</div>');
    expect(html).toContain('<div class="line" data-kind="add">+ new line</div><div class="line" data-kind="add">+ more</div>');
    expect(html).toContain('<div class="line" data-kind="add">+ w1</div><div class="line" data-kind="add">+ w2</div>');
    expect((html.match(/mini-diff/g) ?? []).length).toBe(2);
    expect(html).toContain(">Edit</div>");
    expect(html).toContain(">Content</div>");
    expect(html).toContain(">Input</div><pre");
    expect(html).toContain("&quot;command&quot;: &quot;ls -la&quot;");
    // The result sections stay.
    expect((html.match(/>Result<\/div>/g) ?? []).length).toBe(3);
    const long = editLines("Write", { content: Array.from({ length: 205 }, (_, i) => `l${i}`).join("\n") });
    expect(long?.[0].added).toHaveLength(201);
    expect(long?.[0].added[200]).toBe("… 5 more lines");
  });

  it("colours the fold count by the run's outcome", () => {
    const work = (uuid: string, ...blocks: Block[]): Turn => ({ uuid, role: "assistant", kind: "assistant", timestamp: 0, blocks });
    const ok = tool("o", "Bash", { command: "ls" }, { text: "a", isError: false });
    const bad = tool("b", "Bash", { command: "ls" }, { text: "a", isError: true });
    const pending = tool("p", "Bash", { command: "ls" });
    expect(runStatus([ok, ok])).toBe("ok");
    expect(runStatus([ok, bad])).toBe("error");
    expect(runStatus([ok, pending])).toBe("none");
    expect(runStatus([])).toBe("none");
    const foldHtml = (...blocks: Block[]) => {
      const visible = applyFilters([work("w", ...blocks)], all);
      const { rows } = buildRows(visible, [], new Map());
      const fold = rows[0];
      if (fold.kind !== "fold") throw new Error("expected a fold");
      return renderToString(
        <TooltipProvider>
          <FoldRow row={fold} query="" current={undefined} onToggle={() => {}} />
        </TooltipProvider>,
      );
    };
    expect(foldHtml(ok, ok)).toContain('fold-count shrink-0" data-status="ok">2 tool calls<');
    expect(foldHtml(ok, bad)).toContain('fold-count shrink-0" data-status="error">2 tool calls<');
    expect(foldHtml(pending)).toContain('fold-count shrink-0" data-status="none">1 tool call<');
  });

  it("marks @mentions of known agents in markdown and a yellow rule on usage notices", () => {
    const html = renderToString(
      <AgentsContext.Provider value={{ agents: [{ agentId: "a", name: "scripts-agent", description: "", filePath: "", size: 0, status: "done" }], openAgent: () => {} }}>
        <Markdown text={"Ping @scripts-agent and @nobody; not in `@scripts-agent` code; mail@scripts-agent stays."} query="" />
      </AgentsContext.Provider>,
    );
    expect(html).toContain('Ping <span class="agent-mention">@scripts-agent</span> and @nobody;');
    expect(html).toContain("<code>@scripts-agent</code>");
    expect(html).toContain("mail@scripts-agent stays");
    expect((html.match(/agent-mention/g) ?? []).length).toBe(1);
    const notices: Turn[] = [
      { uuid: "n1", role: "user", kind: "notice", subtype: "informational", timestamp: 0, blocks: [{ type: "text", text: "Usage limit reached · continuing at 7pm" }] },
      { uuid: "n2", role: "user", kind: "notice", subtype: "compact_boundary", timestamp: 0, blocks: [{ type: "text", text: "Conversation compacted" }] },
    ];
    const visible = applyFilters(notices, all);
    const nh = renderToString(
      <TooltipProvider>
        {visible.map((v, i) => (
          <TurnRow key={i} item={v} query="" currentBlock={-1} currentOcc={-1} />
        ))}
      </TooltipProvider>,
    );
    expect((nh.match(/notice-usage/g) ?? []).length).toBe(1);
    expect(nh).toMatch(/notice-usage[^>]*>Usage limit reached/);
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
    expect(open).toContain('Used <span class="tool-fn">Bash</span>');
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
    // The clock carries the full date as its label (and tooltip).
    expect(bubble).toMatch(/time-stamp[^>]*aria-label="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 · [\d:]+( [AP]M)?"/);
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
    expect(bubble).toMatch(/justify-end[^>]*>.*<span[^>]*class="time-stamp[^"]*"[^>]*>\d{1,2}:\d{2}( [AP]M)?<\/span><\/div>/);
    expect(html).toContain("tool-line");
    // Plain "Used <tool>" line, no outlined pill, and the error result is a small "failed".
    expect(html).toContain('Used <span class="tool-fn">Bash</span>');
    expect(html).toContain(">failed<");
    expect(html).not.toContain("tool-pill");
    expect(html).toContain("Thinking…");
    // No "Claude · <time>" meta line; the assistant time is a hover-only stamp with the full date as tooltip.
    expect(html).not.toContain("Claude · ");
    const assistant = html.slice(html.indexOf('data-turn-index="1"'));
    expect(assistant).toMatch(/turn-time[^>]*><span[^>]*aria-label="(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 · [\d:]+( [AP]M)?"[^>]*>\d{1,2}:\d{2}( [AP]M)?<\/span>/);
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
    expect(h1).toMatch(/title="Title\nb\n(Sun|Mon|Tue|Wed|Thu|Fri|Sat), Nov 1[45], 2023 · [\d:]+( [AP]M)?\n15m\nmain\nsess"/);
    expect(html).toMatch(/header-meta[^>]*>Nov 1[45], 2023 · [\d:]+( [AP]M)? · 2 messages</);
    // The project is a folder button carrying the full path; its tooltip and right-click menu hang off it.
    expect(html).toMatch(/folder-button[^>]*aria-label="Open folder \/a\/b"[^>]*data-path="\/a\/b"[^>]*>.*?<span class="min-w-0 truncate">b<\/span>/);
    expect(folderActions(meta).map((a) => a.label)).toEqual([
      "Open in Finder",
      "Copy path",
      "Open in new VS Code window",
      "Add to workspace",
    ]);
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
    // The folder button keeps only its icon when the meta is gone.
    expect(narrow).toMatch(/folder-button[^>]*aria-label="Open folder \/a\/b"/);
    expect(narrow).not.toContain('<span class="min-w-0 truncate">b</span>');
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
    expect(items.before.map((i) => i.label)).toEqual([
      "Save as .txt",
      "Copy transcript",
      "Copy prompt for another agent",
      "Reveal JSONL",
      "Copy session ID",
    ]);
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
    const title = "Mouse wheel zoom setting investigation and the follow-up fixes";
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
    // Opened, the title tooltip shows the full title first and the meta lines muted below it.
    const open = renderToString(
      <TooltipProvider>
        <Header
          meta={{ ...meta, gitBranch: "main" }}
          turnCount={2}
          openAt="oldest"
          onOpenAtChange={() => {}}
          tab="messages"
          onTabChange={() => {}}
          filesCount={0}
          titleTooltipOpen
        />
      </TooltipProvider>,
    );
    const tip = open.slice(open.indexOf("title-tooltip"));
    expect(tip).toContain(`<div class="font-medium break-words">${title}</div>`);
    expect(tip).toMatch(/text-muted-foreground[^>]*>b<\/div>/);
    expect(tip).toMatch(/text-muted-foreground[^>]*>main<\/div>/);
    expect(tip).toMatch(/text-muted-foreground[^>]*>sess<\/div>/);
  });
});

describe("agent rows, status icons and the live header", () => {
  const base = { filePath: "", size: 0 } as const;
  const named: SubagentInfo = { ...base, agentId: "a1", name: "safeshots", description: "Privacy-safe screenshots and video", agentType: "general-purpose", status: "running" };
  const unnamed: SubagentInfo = { ...base, agentId: "a2", description: "Find the config loader", agentType: "general-purpose", status: "done" };
  const failed: SubagentInfo = { ...base, agentId: "a3", name: "video", description: "Record the tour", status: "failed" };
  const unknown: SubagentInfo = { ...base, agentId: "a4", description: "Empty transcript", status: "unknown" };

  it("leads with the name, keeps the description muted, and shows no badge or type for unnamed agents", () => {
    const html = renderToString(
      <>
        <AgentRowLabel agent={named} />
        <AgentRowLabel agent={unnamed} />
      </>,
    );
    expect(html).toMatch(/agent-name[^>]*>safeshots<\/span><span class="[^"]*text-muted-foreground">Privacy-safe screenshots and video<\/span>/);
    expect(html).toContain('title="safeshots  Privacy-safe screenshots and video\nType: general-purpose"');
    expect(html).toMatch(/title="Find the config loader\nType: general-purpose"[^>]*><span class="truncate min-w-0">Find the config loader<\/span><\/span>/);
    expect(html).not.toContain(">general-purpose<");
  });

  it("draws a pulsing blue dot, a green check, a red x and a grey dot per status, and sums them in the header", () => {
    const html = renderToString(
      <>
        <StatusIcon status="running" />
        <StatusIcon status="done" />
        <StatusIcon status="failed" />
        <StatusIcon status="unknown" />
      </>,
    );
    expect(html).toMatch(/aria-label="Running"[^>]*data-status="running"[^>]*class="[^"]*agent-pulse[^"]*charts-blue/);
    expect(html).toMatch(/<svg[^>]*lucide-check[^>]*charts-green[^>]*aria-label="Done"/);
    expect(html).toMatch(/<svg[^>]*lucide-x[^>]*charts-red[^>]*aria-label="Failed"/);
    expect(html).toMatch(/aria-label="Unknown"[^>]*data-status="unknown"[^>]*class="[^"]*bg-muted-foreground\/50/);
    expect(agentsSummary([named, unnamed, failed, unknown])).toBe("Agents (4) · 1 done · 1 running · 1 failed");
    expect(agentsSummary([named, unnamed])).toBe("Agents (2) · 1 done · 1 running");
  });

  it("links a spawn tool call to the agent by name, or by description when unnamed", () => {
    const spawn = (id: string, name?: string): Block => ({ type: "tool_use", id, name: "Agent", input: name ? { name, prompt: "p" } : { prompt: "p" }, summary: "p" });
    const html = renderToString(
      <TooltipProvider>
        <AgentsContext.Provider value={{ agents: [{ ...named, toolUseId: "t1" }, { ...unnamed, toolUseId: "t2" }], openAgent: () => {} }}>
          <ToolUseBlock block={spawn("t1", "safeshots") as Extract<Block, { type: "tool_use" }>} query="" current={-1} />
          <ToolUseBlock block={spawn("t2") as Extract<Block, { type: "tool_use" }>} query="" current={-1} />
        </AgentsContext.Provider>
      </TooltipProvider>,
    );
    expect(html).not.toContain("Open transcript<");
    expect(html).toMatch(/agent-link[^>]*title="Open transcript\nsafeshots {2}Privacy-safe screenshots and video\nType: general-purpose"[^>]*><span class="agent-name truncate">safeshots<\/span><span class="[^"]*text-muted-foreground">Privacy-safe screenshots and video<\/span>/);
    expect(html).toMatch(/agent-link[^>]*><span class="agent-name truncate">Find the config loader<\/span><\/button>/);
  });

  it("shows the Live indicator and the reload button in header row 1", () => {
    const meta: SessionMeta = { sessionId: "s", filePath: "/f", cwd: "/a", projectName: "a", title: "T", titleSource: "ai", messageCount: 1, filesChanged: 0, mtime: 0, size: 0 };
    const render = (live: boolean) =>
      renderToString(
        <TooltipProvider>
          <Header meta={meta} turnCount={1} openAt="oldest" onOpenAtChange={() => {}} tab="messages" onTabChange={() => {}} filesCount={0} width={1000} live={live} onReload={() => {}} />
        </TooltipProvider>,
      );
    const on = render(true);
    expect(on).toMatch(/live-indicator[^>]*>.*agent-pulse.*Live<\/span>/s);
    expect(on).toMatch(/aria-label="Reload transcript"[^>]*>.*aria-label="Resume"/s);
    expect(render(false)).not.toContain("live-indicator");
  });
});

describe("agents menu with workflow runs", () => {
  const base = { filePath: "", size: 0 } as const;
  const direct: SubagentInfo[] = [
    { ...base, agentId: "d1", name: "reviewer", description: "Review the diff", status: "done" },
    { ...base, agentId: "d2", name: "theme-builder", description: "Build the theme", status: "running" },
  ];
  const wf = (agentId: string, description: string, phase: string | undefined, status: SubagentInfo["status"] = "done"): SubagentInfo => ({
    ...base,
    agentId,
    description,
    agentType: "workflow-subagent",
    status,
    runId: "wf_1",
    ...(phase ? { phase } : {}),
  });
  const done: WorkflowRun = {
    runId: "wf_1",
    name: "part-07",
    summary: "coder, reviewer, gate",
    status: "completed",
    startedAt: 2,
    durationMs: 54 * 60_000,
    totalTokens: 466_478,
    totalToolCalls: 103,
    phases: ["Code", "Review", "Gate"],
    agents: [wf("w1", "code:07", "Code"), wf("w2", "review:07", "Review", "failed"), wf("w3", "gate:07", "Gate"), wf("w4", "stray", undefined)],
  };
  const live: WorkflowRun = { runId: "wf_2", name: "part-06", status: "running", startedAt: 3, phases: ["Code"], agents: [wf("w5", "code:06", "Code", "running")] };
  const noop = () => {};

  it("counts every agent and describes runs by status, duration, tokens and tool calls", () => {
    expect(agentTotal(direct, [done, live])).toBe(7);
    expect(runRowDetail(done)).toBe("completed · 54m · 4 agents");
    expect(runRowDetail(live)).toBe("running · 1 agent");
    expect(runSummaryLine(done)).toBe("completed · 54m · 466.5k tokens · 103 tool calls");
    expect(runIconStatus("completed")).toBe("done");
    expect(runIconStatus("killed")).toBe("failed");
    expect(runIconStatus("running")).toBe("running");
    expect(runIconStatus("unknown")).toBe("unknown");
  });

  it("lists Workflows and Direct agents sections at the top level", () => {
    const html = renderToString(<AgentsMenu agents={direct} workflows={[live, done]} level={{ kind: "root" }} onLevel={noop} onOpen={noop} />);
    expect(html).toContain(">Workflows<");
    expect(html).toContain(">Direct agents<");
    expect(html.indexOf(">part-06<")).toBeLessThan(html.indexOf(">part-07<"));
    expect(html).toContain(">completed · 54m · 4 agents<");
    expect(html).toContain(">running · 1 agent<");
    expect(html).toContain(">Agents (2) · 1 done · 1 running<");
    expect(html).not.toContain("agent-row");
  });

  it("hides the Direct agents section when there are none", () => {
    const html = renderToString(<AgentsMenu agents={[]} workflows={[done]} level={{ kind: "root" }} onLevel={noop} onOpen={noop} />);
    expect(html).toContain(">Workflows<");
    expect(html).not.toContain(">Direct agents<");
  });

  it("groups a run's agents under its phase titles in phase order, unphased last", () => {
    expect(phaseGroups(done).map((g) => [g.title, g.agents.map((a) => a.description)])).toEqual([
      ["Code", ["code:07"]],
      ["Review", ["review:07"]],
      ["Gate", ["gate:07"]],
      ["Other", ["stray"]],
    ]);
    const html = renderToString(<AgentsMenu agents={direct} workflows={[done]} level={{ kind: "run", runId: "wf_1" }} onLevel={noop} onOpen={noop} />);
    expect(html).toContain("agents-back");
    expect(html).toContain(">part-07<");
    expect(html).toContain(">completed · 54m · 466.5k tokens · 103 tool calls<");
    const order = ["Code", "code:07", "Review", "review:07", "Gate", "gate:07", "Other", "stray"].map((t) => html.indexOf(`>${t}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain(">reviewer<");
  });

  it("shows the direct agents list behind a back control", () => {
    const html = renderToString(<AgentsMenu agents={direct} workflows={[done]} level={{ kind: "direct" }} onLevel={noop} onOpen={noop} />);
    expect(html).toContain("agents-back");
    expect(html).toContain(">reviewer<");
    expect(html).toContain(">theme-builder<");
    expect(html).not.toContain(">code:07<");
  });

  it("opens straight to the direct agents list when the session has no workflow runs", () => {
    const html = renderToString(<AgentsMenu agents={direct} workflows={[]} level={{ kind: "root" }} onLevel={noop} onOpen={noop} />);
    expect(html).not.toContain("agents-back");
    expect(html).not.toContain(">Workflows<");
    expect(html).toContain(">Agents (2) · 1 done · 1 running<");
    expect(html).toContain(">reviewer<");
  });
});
