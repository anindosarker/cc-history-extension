import { describe, expect, it } from "vitest";
import { agentPrompt, buildTranscript, exportFileName, referenceMessageCount, slugify } from "../src/extension/exporter";
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

describe("reference transcript for another agent", () => {
  const session: SessionData = {
    ...data,
    turns: [
      { ...data.turns[0], timestamp: Date.UTC(2026, 0, 2, 10) },
      { ...data.turns[1], timestamp: Date.UTC(2026, 0, 2, 10, 1) },
      {
        uuid: "3",
        role: "user",
        kind: "system",
        label: "task notification",
        timestamp: 0,
        blocks: [{ type: "text", text: "<task-notification>injected</task-notification>" }],
      },
      {
        uuid: "4",
        role: "assistant",
        kind: "assistant",
        timestamp: 0,
        blocks: [{ type: "tool_use", id: "u", name: "Read", input: {}, summary: "a.ts", result: { text: "file body", isError: false } }],
      },
      { uuid: "5", role: "assistant", kind: "assistant", timestamp: 0, blocks: [{ type: "text", text: "All done." }] },
    ],
  };

  it("numbers user and Claude messages and leaves out tools, thinking and injected rows", () => {
    // Tool output and thinking stay out even when the export settings would include them.
    const text = buildTranscript(session, { includeThinking: true, includeToolResults: true, format: "reference" });
    expect(text).toMatch(/^## \[1\] User · .+\nPlease fix it$/m);
    expect(text).toMatch(/^## \[2\] Claude · .+\nSure\.$/m);
    expect(text).toContain("## [3] Claude\nAll done.");
    expect(text).not.toContain("## [4]");
    expect(text).not.toContain("private");
    expect(text).not.toContain("[Tool");
    expect(text).not.toContain("file body");
    expect(text).not.toContain("a\nb");
    expect(text).not.toContain("injected");
    expect(referenceMessageCount(session)).toBe(3);
  });

  it("writes a prompt with the quoted path, the title and the grep instruction", () => {
    const prompt = agentPrompt({
      title: "Fix the bug",
      projectName: "proj",
      startedAt: Date.UTC(2026, 0, 2, 10),
      messageCount: 3,
      path: "/Users/me/Library/Application Support/Code/refs/abc.md",
    });
    expect(prompt).toContain('Earlier Claude Code session: "Fix the bug" (proj, ');
    expect(prompt).toContain(", 3 messages).");
    expect(prompt).toContain('Transcript: "/Users/me/Library/Application Support/Code/refs/abc.md"');
    expect(prompt).toContain("grep -n for what you need, then read only those line ranges.");
    expect(prompt.endsWith("Question:")).toBe(true);
  });
});
