import { describe, expect, it } from "vitest";
import { buildTranscript, exportFileName, slugify } from "../src/extension/exporter";
import type { SessionData } from "../src/shared/types";

const data: SessionData = {
  meta: {
    sessionId: "abc",
    filePath: "/p/abc.jsonl",
    cwd: "/home/me/proj",
    projectName: "proj",
    title: "Fix the bug",
    titleSource: "ai",
    messageCount: 2,
    filesChanged: 0,
    mtime: 0,
    size: 0,
    startedAt: Date.UTC(2026, 0, 2, 10),
    gitBranch: "main",
  },
  files: [],
  turns: [
    { uuid: "1", role: "user", kind: "user", timestamp: 0, blocks: [{ type: "text", text: "Please fix it" }] },
    {
      uuid: "2",
      role: "assistant",
      kind: "assistant",
      timestamp: 0,
      blocks: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Sure." },
        {
          type: "tool_use",
          id: "t",
          name: "Bash",
          input: { command: "ls" },
          summary: "ls",
          result: { text: "a\nb", isError: false },
        },
      ],
    },
  ],
};

describe("exporter", () => {
  it("writes a /export style transcript without thinking or tool results by default", () => {
    const text = buildTranscript(data, { includeThinking: false, includeToolResults: false });
    expect(text).toContain("# Fix the bug");
    expect(text).toContain("Project: /home/me/proj");
    expect(text).toContain("Branch: main");
    expect(text).toContain("User:\nPlease fix it\n\nAssistant:\nSure.\n[Tool: Bash] ls\n");
    expect(text).not.toContain("private");
    expect(text).not.toContain("a\nb");
  });

  it("includes thinking and tool results when asked", () => {
    const text = buildTranscript(data, { includeThinking: true, includeToolResults: true });
    expect(text).toContain("[Thinking]\nprivate");
    expect(text).toContain("[Tool result]\na\nb");
  });

  it("builds a safe file name", () => {
    expect(slugify("Fix the bug! (now)")).toBe("fix-the-bug-now");
    expect(exportFileName("Fix the bug", Date.UTC(2026, 0, 2, 10))).toBe("fix-the-bug-2026-01-02.txt");
  });
});

describe("export of pasted images", () => {
  it("writes [image] for inline and omitted images alike", () => {
    const withImages: SessionData = {
      ...data,
      turns: [
        {
          uuid: "i",
          role: "user",
          kind: "user",
          timestamp: 0,
          blocks: [
            { type: "text", text: "look" },
            { type: "image", mediaType: "image/png", data: "abc=" },
            { type: "image", omitted: true, bytes: 5 },
          ],
        },
      ],
    };
    const text = buildTranscript(withImages, { includeToolResults: false, includeThinking: false });
    expect(text).toContain("User:\nlook\n[image]\n[image]");
    expect(text).not.toContain("abc=");
  });
});
