import { describe, expect, it } from "vitest";
import { extractFileChanges, countLines, stripLineNumbers } from "../src/extension/diff";
import { parseSessionText } from "../src/extension/parser";
import { assistantMsg, readResult, toolResult, toolUse } from "./fixtures";

function changes(lines: string[]) {
  return extractFileChanges(parseSessionText(lines.join("\n")).turns);
}

describe("diff extraction", () => {
  it("reconstructs a file from Read plus Edit", () => {
    const [f] = changes([
      assistantMsg([toolUse("r1", "Read", { file_path: "/a.ts" })]),
      readResult("r1", "const a = 1;\nconst b = 2;\n"),
      assistantMsg([toolUse("e1", "Edit", { file_path: "/a.ts", old_string: "const b = 2;", new_string: "const b = 3;\nconst c = 4;" })]),
      toolResult("e1", "ok"),
    ]);
    expect(f.path).toBe("/a.ts");
    expect(f.partial).toBe(false);
    expect(f.before).toBe("const a = 1;\nconst b = 2;\n");
    expect(f.after).toBe("const a = 1;\nconst b = 3;\nconst c = 4;\n");
    expect(f.hunks).toHaveLength(1);
    expect(f.added).toBe(2);
    expect(f.removed).toBe(1);
  });

  it("marks files partial when an old_string is missing, but keeps hunks", () => {
    const [f] = changes([
      assistantMsg([toolUse("e1", "Edit", { file_path: "/b.ts", old_string: "nope", new_string: "yes" })]),
      toolResult("e1", "ok"),
    ]);
    expect(f.partial).toBe(true);
    expect(f.before).toBeUndefined();
    expect(f.hunks[0]).toMatchObject({ before: "nope", after: "yes", added: 1, removed: 1 });
  });

  it("skips tool calls whose result was an error", () => {
    const out = changes([
      assistantMsg([toolUse("e1", "Edit", { file_path: "/c.ts", old_string: "x", new_string: "y" })]),
      toolResult("e1", "String not found", true),
    ]);
    expect(out).toHaveLength(0);
  });

  it("treats Write as all added when nothing was read before", () => {
    const [f] = changes([
      assistantMsg([toolUse("w1", "Write", { file_path: "/new.md", content: "a\nb\nc" })]),
      toolResult("w1", "ok"),
    ]);
    expect(f.added).toBe(3);
    expect(f.removed).toBe(0);
    expect(f.before).toBe("");
    expect(f.after).toBe("a\nb\nc");
  });

  it("handles MultiEdit, replace_all and NotebookEdit, preserving first-seen order", () => {
    const out = changes([
      assistantMsg([toolUse("w1", "Write", { file_path: "/z.ts", content: "foo foo\nbar\n" })]),
      toolResult("w1", "ok"),
      assistantMsg([toolUse("n1", "NotebookEdit", { notebook_path: "/n.ipynb", new_source: "print(1)" })]),
      toolResult("n1", "ok"),
      assistantMsg([
        toolUse("m1", "MultiEdit", {
          file_path: "/z.ts",
          edits: [
            { old_string: "foo", new_string: "qux", replace_all: true },
            { old_string: "bar", new_string: "baz" },
          ],
        }),
      ]),
      toolResult("m1", "ok"),
    ]);
    expect(out.map((f) => f.path)).toEqual(["/z.ts", "/n.ipynb"]);
    expect(out[0].after).toBe("qux qux\nbaz\n");
    expect(out[0].hunks).toHaveLength(3);
    expect(out[1].hunks[0].tool).toBe("NotebookEdit");
  });

  it("strips cat -n style prefixes and trailing system reminders", () => {
    expect(stripLineNumbers("     1\tfoo\n     2\tbar\n\n<system-reminder>x</system-reminder>")).toBe("foo\nbar\n");
    expect(stripLineNumbers("plain\ntext")).toBe("plain\ntext");
  });

  it("counts lines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
  });
});
