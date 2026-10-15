import { describe, expect, it } from "vitest";
import { base64Bytes, MAX_IMAGE_BASE64_CHARS, parseSessionText } from "../src/extension/parser";
import { assistantMsg, line, toolResult, toolUse, userMsg } from "./fixtures";

describe("parser", () => {
  it("builds user and assistant turns and attaches tool results", () => {
    const text = [
      userMsg("hello there"),
      assistantMsg([{ type: "text", text: "Let me look." }], {}, "m1"),
      assistantMsg([toolUse("t1", "Bash", { command: "ls -la", description: "List files" })], {}, "m1"),
      toolResult("t1", "file-a\nfile-b"),
      assistantMsg([{ type: "text", text: "Done." }], {}, "m2"),
    ].join("\n");
    const s = parseSessionText(text);
    expect(s.turns.map((t) => t.role)).toEqual(["user", "assistant", "assistant"]);
    const merged = s.turns[1];
    expect(merged.blocks).toHaveLength(2);
    const tool = merged.blocks[1];
    expect(tool.type).toBe("tool_use");
    if (tool.type === "tool_use") {
      expect(tool.summary).toBe("List files");
      expect(tool.result?.text).toBe("file-a\nfile-b");
      expect(tool.result?.isError).toBe(false);
    }
    expect(s.cwd).toBe("/home/me/proj");
    expect(s.gitBranch).toBe("main");
    expect(s.firstPrompt).toBe("hello there");
    expect(s.sessionId).toBe("sess-1");
  });

  it("drops meta and sidechain records and files slash-command noise as system turns", () => {
    const text = [
      userMsg("<command-name>/clear</command-name>"),
      userMsg("<local-command-stdout>ok</local-command-stdout>"),
      userMsg("secret meta", { isMeta: true }),
      userMsg("side", { isSidechain: true }),
      line({ type: "file-history-snapshot", snapshot: {} }),
      "not json at all",
      "",
      userMsg("real prompt"),
    ].join("\n");
    const s = parseSessionText(text);
    // Slash-command echoes are kept as collapsed system turns; meta, sidechain and junk lines are dropped.
    expect(s.turns.map((t) => t.kind)).toEqual(["system", "system", "user"]);
    expect(s.turns[0].label).toBe("command /clear");
    expect(s.turns[1].label).toBe("command output");
    expect(s.firstPrompt).toBe("real prompt");
  });

  it("does not render tool_result only records as turns", () => {
    const text = [
      assistantMsg([toolUse("t1", "Read", { file_path: "/a.ts" })]),
      toolResult("t1", [{ type: "text", text: "content" }]),
    ].join("\n");
    const s = parseSessionText(text);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].role).toBe("assistant");
  });

  it("keeps thinking blocks and flags error results", () => {
    const text = [
      assistantMsg([{ type: "thinking", thinking: "hmm" }, toolUse("t1", "Edit", { file_path: "/x" })]),
      toolResult("t1", "String not found", true),
    ].join("\n");
    const s = parseSessionText(text);
    const [thinking, tool] = s.turns[0].blocks;
    expect(thinking.type).toBe("thinking");
    expect(tool.type === "tool_use" && tool.result?.isError).toBe(true);
  });

  it("uses the first cwd seen and tracks timestamps", () => {
    const text = [
      userMsg("a", { cwd: "/first", timestamp: "2026-01-01T00:00:00.000Z" }),
      assistantMsg([{ type: "text", text: "b" }], { cwd: "/second", timestamp: "2026-01-01T01:00:00.000Z" }),
    ].join("\n");
    const s = parseSessionText(text);
    expect(s.cwd).toBe("/first");
    expect(s.startedAt).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(s.lastActivityAt).toBe(Date.parse("2026-01-01T01:00:00.000Z"));
  });
});

describe("pasted images", () => {
  const image = (data: string) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

  it("keeps a pasted image as an image block next to the prompt text", () => {
    const s = parseSessionText([userMsg([{ type: "text", text: "what is this" }, image("iVBORw0KGgo=")])].join("\n"));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].kind).toBe("user");
    expect(s.turns[0].blocks).toEqual([
      { type: "text", text: "what is this" },
      { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
    ]);
    // A text reference Claude Code leaves in some prompts stays plain text.
    const ref = parseSessionText(userMsg("[Image: source: /tmp/shot.png]"));
    expect(ref.turns[0].blocks).toEqual([{ type: "text", text: "[Image: source: /tmp/shot.png]" }]);
  });

  it("replaces an image over the cap with a placeholder that says how big it was", () => {
    const big = "A".repeat(MAX_IMAGE_BASE64_CHARS + 4);
    const s = parseSessionText(userMsg([image(big)]));
    expect(s.turns[0].blocks).toEqual([{ type: "image", omitted: true, bytes: base64Bytes(big) }]);
    expect(base64Bytes(big)).toBe(((MAX_IMAGE_BASE64_CHARS + 4) * 3) / 4);
    expect(base64Bytes("iVBORw0KGgo=")).toBe(8);
    const atCap = parseSessionText(userMsg([image("A".repeat(MAX_IMAGE_BASE64_CHARS))]));
    expect(atCap.turns[0].blocks[0]).toMatchObject({ type: "image", mediaType: "image/png" });
  });
});
