import { describe, expect, it } from "vitest";
import { resolveTitle } from "../src/shared/title";
import { indexText } from "../src/extension/indexScan";
import { assistantMsg, line, userMsg } from "./fixtures";

describe("title precedence", () => {
  it("prefers custom over ai over prompt over id", () => {
    expect(resolveTitle({ customTitle: "C", aiTitle: "A", firstPrompt: "P", sessionId: "id" }).title).toBe("C");
    expect(resolveTitle({ aiTitle: "A", firstPrompt: "P", sessionId: "id" }).title).toBe("A");
    expect(resolveTitle({ firstPrompt: "P", sessionId: "id" })).toEqual({ title: "P", source: "prompt" });
    expect(resolveTitle({ sessionId: "id" })).toEqual({ title: "id", source: "id" });
  });

  it("ignores blank titles and truncates long prompts to 80 chars", () => {
    const long = "x".repeat(200);
    const r = resolveTitle({ customTitle: "  ", aiTitle: "", firstPrompt: long, sessionId: "id" });
    expect(r.source).toBe("prompt");
    expect(r.title.length).toBe(80);
    expect(r.title.endsWith("…")).toBe(true);
  });

  it("picks up title records anywhere in the file during indexing", () => {
    const text = [
      userMsg("first prompt here"),
      assistantMsg([{ type: "text", text: "ok" }]),
      line({ type: "ai-title", aiTitle: "AI title", sessionId: "sess-1" }),
      userMsg("second"),
      line({ type: "custom-title", customTitle: "My title", sessionId: "sess-1" }),
    ].join("\n");
    const meta = indexText(text, "/p/-home-me-proj/sess-1.jsonl");
    expect(meta.title).toBe("My title");
    expect(meta.titleSource).toBe("custom");
    expect(meta.firstPrompt).toBe("first prompt here");
    expect(meta.messageCount).toBe(3);
    expect(meta.cwd).toBe("/home/me/proj");
    expect(meta.projectName).toBe("proj");
  });

  it("falls back to the decoded dir name and file name when records lack cwd and sessionId", () => {
    const meta = indexText(line({ type: "mode", mode: "x" }), "/p/-home-me-other/abc.jsonl");
    expect(meta.sessionId).toBe("abc");
    expect(meta.cwd).toBe("/home/me/other");
    expect(meta.title).toBe("abc");
    expect(meta.messageCount).toBe(0);
  });
});

describe("title fallbacks for slash commands and bare sessions", () => {
  it("skips slash-command echoes and uses the next real prompt", () => {
    const text = [
      userMsg("<command-message>daily-report</command-message>\n<command-name>/daily-report</command-name>"),
      userMsg("<local-command-stdout>done</local-command-stdout>"),
      userMsg("please triage the feedback"),
    ].join("\n");
    const meta = indexText(text, "/p/-home-me-proj/sess-1.jsonl");
    expect(meta.title).toBe("please triage the feedback");
    expect(meta.firstPrompt).toBe("please triage the feedback");
    expect(meta.messageCount).toBe(1);
  });

  it("derives the title from the command when no real prompt exists", () => {
    const text = [
      userMsg("<command-message>daily-report</command-message>\n<command-name>/daily-report</command-name>"),
      assistantMsg([{ type: "text", text: "ok" }]),
    ].join("\n");
    const meta = indexText(text, "/p/-home-me-proj/sess-1.jsonl");
    expect(meta.title).toBe("/daily-report");
    expect(meta.titleSource).toBe("command");
  });

  it("uses the start date instead of the uuid when nothing else is usable", () => {
    const text = assistantMsg([{ type: "text", text: "ok" }], { timestamp: "2026-03-04T05:06:07.000Z" });
    const meta = indexText(text, "/p/-home-me-proj/0f0f0f0f.jsonl");
    expect(meta.titleSource).toBe("date");
    expect(meta.title).toMatch(/^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(meta.sessionId).toBe("sess-1");
    const r = resolveTitle({ sessionId: "abc" });
    expect(r).toEqual({ title: "abc", source: "id" });
  });
});
