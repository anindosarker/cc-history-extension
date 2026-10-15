import { describe, expect, it } from "vitest";
import { parseSessionText } from "../src/extension/parser";
import { indexText } from "../src/extension/indexScan";
import { buildTranscript } from "../src/extension/exporter";
import type { SessionData } from "../src/shared/types";
import { assistantMsg, userMsg } from "./fixtures";

const idlePayload = JSON.stringify({ type: "idle_notification", result: "Finished the parser.\n\nAll tests pass." });
const teammate = userMsg(
  `<teammate-message teammate_id="scripts-agent" summary="parser done">${idlePayload}</teammate-message>`,
);
const crossSession = userMsg(
  'Another Claude session sent a message:\n<cross-session-message from="worker [3fa9c1]">check the build over there</cross-session-message>',
);
const reminder = userMsg("<system-reminder>\nThe file was modified.\n</system-reminder>");
const interrupted = userMsg("[Request interrupted by user for tool use]");
const plainPrompt = userMsg("ask the teammate to review the teammate-message parser");

describe("user record kinds", () => {
  it("files a teammate message with an idle_notification result as an agent turn", () => {
    const s = parseSessionText([teammate, assistantMsg([{ type: "text", text: "ok" }])].join("\n"));
    const t = s.turns[0];
    expect(t.kind).toBe("agent");
    expect(t.role).toBe("user");
    expect(t.agentName).toBe("scripts-agent");
    expect(t.summary).toBe("parser done");
    expect(t.blocks).toEqual([{ type: "text", text: "Finished the parser.\n\nAll tests pass." }]);
    expect(s.firstPrompt).toBeUndefined();
  });

  it("turns an idle notification without a result into a short status line, never raw JSON", () => {
    const wrap = (payload: unknown) =>
      userMsg(`<teammate-message teammate_id="skill-agent">${JSON.stringify(payload)}</teammate-message>`);
    const available = parseSessionText(
      wrap({ type: "idle_notification", from: "skill-agent", timestamp: "2026-09-18T09:24:41Z", idleReason: "available" }),
    ).turns[0];
    expect(available.kind).toBe("agent");
    expect(available.blocks).toEqual([{ type: "text", text: "Idle (available)" }]);
    const failed = parseSessionText(
      wrap({ type: "idle_notification", from: "x", idleReason: "failed", failureReason: "hit the session limit" }),
    ).turns[0];
    expect(failed.blocks).toEqual([{ type: "text", text: "Idle (failed): hit the session limit" }]);
    const bare = parseSessionText(wrap({ type: "idle_notification", from: "x", sessionId: "s" })).turns[0];
    expect(bare.blocks).toEqual([{ type: "text", text: "Idle" }]);
    // A message field is used when there is no result; other payloads stay readable JSON.
    const msg = parseSessionText(wrap({ type: "note", message: "ping" })).turns[0];
    expect(msg.blocks).toEqual([{ type: "text", text: "ping" }]);
    const other = parseSessionText(wrap({ type: "custom", count: 2 })).turns[0];
    expect(other.blocks[0]).toEqual({ type: "text", text: '{\n  "type": "custom",\n  "count": 2\n}' });
  });

  it("files a cross-session message as an agent turn with the wrapper and tags stripped", () => {
    const t = parseSessionText(crossSession).turns[0];
    expect(t.kind).toBe("agent");
    expect(t.agentName).toBe("worker [3fa9c1]");
    expect(t.summary).toBeUndefined();
    expect(t.blocks).toEqual([{ type: "text", text: "check the build over there" }]);
  });

  it("files system reminders and interruption markers as system turns with labels", () => {
    const s = parseSessionText([reminder, interrupted].join("\n"));
    expect(s.turns.map((t) => t.kind)).toEqual(["system", "system"]);
    expect(s.turns[0].label).toBe("system reminder");
    expect(s.turns[1].label).toBe("interrupted");
    expect(s.turns[0].blocks[0]).toEqual({ type: "text", text: "<system-reminder>\nThe file was modified.\n</system-reminder>" });
    expect(s.firstPrompt).toBeUndefined();
  });

  it("keeps a prompt that merely mentions a teammate as a user turn", () => {
    const t = parseSessionText(plainPrompt).turns[0];
    expect(t.kind).toBe("user");
    expect(t.agentName).toBeUndefined();
  });

  it("keeps a prompt bundled with an injected reminder block as the user's prompt", () => {
    const text = userMsg([
      { type: "text", text: "<system-reminder>context</system-reminder>" },
      { type: "text", text: "please fix the header" },
    ]);
    const s = parseSessionText(text);
    expect(s.turns[0].kind).toBe("user");
    expect(s.firstPrompt).toBe("please fix the header");
  });

  it("ignores agent and system records for the title, first prompt and message count", () => {
    const text = [
      reminder,
      teammate,
      crossSession,
      plainPrompt,
      assistantMsg([{ type: "text", text: "ok" }]),
      interrupted,
    ].join("\n");
    const meta = indexText(text, "/p/-home-me-proj/sess-1.jsonl");
    expect(meta.titleSource).toBe("prompt");
    expect(meta.title).toBe("ask the teammate to review the teammate-message parser");
    expect(meta.firstPrompt).toBe("ask the teammate to review the teammate-message parser");
    expect(meta.messageCount).toBe(2);
  });
});

describe("agent and system turns in export", () => {
  const data: SessionData = {
    meta: {
      sessionId: "abc",
      filePath: "/p/abc.jsonl",
      cwd: "/home/me/proj",
      projectName: "proj",
      title: "T",
      titleSource: "ai",
      messageCount: 2,
      filesChanged: 0,
      mtime: 0,
      size: 0,
    },
    files: [],
    turns: [
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
    ],
  };

  it("exports agent turns under an Agent heading and system turns only with tool results", () => {
    const plain = buildTranscript(data, { includeThinking: false, includeToolResults: false });
    expect(plain).toContain("User:\ndo it\n\nAgent (scripts-agent):\nFinished it\n\nAssistant:\nGreat\n");
    expect(plain).not.toContain("System");
    const full = buildTranscript(data, { includeThinking: false, includeToolResults: true });
    expect(full).toContain("System (task notification):\n<task-notification>finished</task-notification>");
  });
});
