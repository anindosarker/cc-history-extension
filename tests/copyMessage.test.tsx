import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { ButtonProps } from "@/components/ui/button";
import { TurnRow } from "@/components/TurnRow";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyFilters } from "@/lib/search";
import type { Turn } from "@shared/types";

// Server rendering drops handlers, so the Button records its props and the test clicks by hand.
const buttons = vi.hoisted(() => [] as ButtonProps[]);
const posted = vi.hoisted(() => [] as unknown[]);

vi.mock("@/lib/vscode", () => ({ post: (msg: unknown) => posted.push(msg) }));
vi.mock("@/components/ui/button", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...real,
    Button: (props: ButtonProps) => {
      buttons.push(props);
      return <real.Button {...props} />;
    },
  };
});

const turns: Turn[] = [
  { uuid: "1", role: "user", kind: "user", timestamp: 1_700_000_000_000, blocks: [{ type: "text", text: "Fix **it**" }] },
  {
    uuid: "2",
    role: "assistant",
    kind: "assistant",
    timestamp: 1_700_000_000_000,
    blocks: [
      { type: "text", text: "First *part*." },
      { type: "tool_use", id: "t", name: "Bash", input: { command: "ls" }, summary: "ls" },
      { type: "text", text: "Second `part`." },
    ],
  },
];

function render(turn: number): string {
  const visible = applyFilters(turns, { role: "all", showThinking: true, showTools: true });
  return renderToString(
    <TooltipProvider>
      <TurnRow item={visible[turn]} query="" currentBlock={-1} currentOcc={-1} />
    </TooltipProvider>,
  );
}

function copyButtons(): ButtonProps[] {
  return buttons.filter((b) => b["aria-label"] === "Copy message");
}

describe("copy a whole message", () => {
  beforeEach(() => {
    buttons.length = 0;
    posted.length = 0;
  });

  it("gives every Claude text block a hover frame and a copy button for its markdown source", () => {
    const html = render(1);
    expect((html.match(/class="text-block /g) ?? []).length).toBe(2);
    expect((html.match(/aria-label="Copy message"/g) ?? []).length).toBe(2);
    const found = copyButtons();
    expect(found.map((b) => b.variant)).toEqual(["ghost", "ghost"]);
    for (const b of found) b.onClick?.({} as never);
    expect(posted).toEqual([
      { type: "copyText", text: "First *part*." },
      { type: "copyText", text: "Second `part`." },
    ]);
  });

  it("gives the user card one copy button next to its stamp and no hover frame", () => {
    const html = render(0);
    expect(html).not.toContain("text-block");
    const bubble = html.slice(html.indexOf("chat-bubble"));
    expect(bubble).toMatch(/aria-label="Copy message".*class="time-stamp/);
    const found = copyButtons();
    expect(found).toHaveLength(1);
    found[0].onClick?.({} as never);
    expect(posted).toEqual([{ type: "copyText", text: "Fix **it**" }]);
  });
});
