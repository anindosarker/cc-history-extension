import { describe, expect, it } from "vitest";
import { COMMAND_DEDUPE_MS, parseSessionText } from "../src/extension/parser";
import { buildTranscript } from "../src/extension/exporter";
import { indexText } from "../src/extension/indexScan";
import { classifyRecord, recapText, systemRecordKind } from "../src/extension/records";
import type { SessionData } from "../src/shared/types";
import { assistantMsg, line, userMsg } from "./fixtures";

const T0 = Date.UTC(2026, 9, 14, 19, 51, 13, 753);
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

/** A top-level system record as Claude Code writes it. */
function systemRecord(subtype: string, content: string | undefined, offsetMs = 0, extra: Record<string, unknown> = {}) {
  return line({
    type: "system",
    subtype,
    ...(content === undefined ? {} : { content }),
    timestamp: iso(offsetMs),
    uuid: `sys-${subtype}-${offsetMs}`,
    isSidechain: false,
    isMeta: false,
    cwd: "/home/me/proj",
    sessionId: "sess-1",
    ...extra,
  });
}

const RECAP = "Goal: ship the viewer. Done: header, filters. Next: file links. (disable recaps in /config)";
const COMMAND_ECHO = "<command-name>/rename</command-name>\n<command-message>rename</command-message>\n<command-args></command-args>";

describe("top-level system records", () => {
  it("classifies each subtype into a recap, a notice, a system line, or nothing", () => {
    const kinds: Record<string, string> = {};
    for (const [subtype, content] of [
      ["away_summary", RECAP],
      ["compact_boundary", "Conversation compacted"],
      ["informational", "Usage limit reached · continuing automatically at 7:50pm · esc or type to cancel"],
      ["scheduled_task_fire", "Running scheduled task (Sep 19 1:04am)"],
      ["bridge_status", "/remote-control is active · Continue here, on your phone, or at https://claude.ai/code/x"],
      ["local_command", COMMAND_ECHO],
      ["agents_killed", undefined],
      ["stop_hook_summary", undefined],
      ["turn_duration", undefined],
      ["something_new", "text"],
    ] as const) {
      kinds[subtype] = classifyRecord(JSON.parse(systemRecord(subtype, content)));
    }
    expect(kinds).toEqual({
      away_summary: "recap",
      compact_boundary: "notice",
      informational: "notice",
      scheduled_task_fire: "system",
      bridge_status: "system",
      local_command: "system",
      agents_killed: "skip",
      stop_hook_summary: "skip",
      turn_duration: "skip",
      something_new: "skip",
    });
    // A known subtype without content is nothing to show either.
    expect(systemRecordKind(JSON.parse(systemRecord("informational", "   ")))).toBe("skip");
    expect(recapText(RECAP)).toBe("Goal: ship the viewer. Done: header, filters. Next: file links.");
  });

  it("parses the shown subtypes into typed turns and drops the rest", () => {
    const text = [
      userMsg("hello", { timestamp: iso(-60_000) }),
      systemRecord("stop_hook_summary", undefined, 0, { hookCount: 3 }),
      systemRecord("turn_duration", undefined, 1, { durationMs: 53922 }),
      systemRecord("away_summary", RECAP, 10),
      systemRecord("informational", "Usage limit reached · continuing automatically at 7:50pm · esc or type to cancel", 20),
      systemRecord("compact_boundary", "Conversation compacted", 30),
      systemRecord("scheduled_task_fire", "Running scheduled task (Sep 19 1:04am)", 40),
      systemRecord("bridge_status", "/remote-control is active · Continue here", 50),
      systemRecord("agents_killed", undefined, 60),
      systemRecord("local_command", "<local-command-stdout>Session renamed to x</local-command-stdout>", 70),
      assistantMsg([{ type: "text", text: "ok" }], { timestamp: iso(80) }),
    ].join("\n");
    const s = parseSessionText(text);
    expect(s.turns.map((t) => t.kind)).toEqual([
      "user",
      "recap",
      "notice",
      "notice",
      "system",
      "system",
      "system",
      "assistant",
    ]);
    const [, recap, usage, compact, scheduled, bridge, stdout] = s.turns;
    expect(recap).toMatchObject({
      role: "user",
      subtype: "away_summary",
      timestamp: T0 + 10,
      blocks: [{ type: "text", text: "Goal: ship the viewer. Done: header, filters. Next: file links." }],
    });
    expect(usage.blocks).toEqual([{ type: "text", text: "Usage limit reached · continuing automatically at 7:50pm · esc or type to cancel" }]);
    expect(usage.subtype).toBe("informational");
    expect(compact.blocks).toEqual([{ type: "text", text: "Conversation compacted" }]);
    expect(scheduled).toMatchObject({ label: "scheduled task", subtype: "scheduled_task_fire" });
    expect(bridge).toMatchObject({ label: "remote control", subtype: "bridge_status" });
    expect(stdout).toMatchObject({ label: "command output", subtype: "local_command" });
    // The time range still spans the records that were shown.
    expect(s.startedAt).toBe(T0 - 60_000);
    expect(s.lastActivityAt).toBe(T0 + 80);
  });

  it("keeps one of a local_command record and its user echo when they name the same command within 2s", () => {
    const echoFirst = parseSessionText(
      [
        userMsg(COMMAND_ECHO, { timestamp: iso(0) }),
        systemRecord("local_command", COMMAND_ECHO, 90),
        userMsg("real prompt", { timestamp: iso(5000) }),
      ].join("\n"),
    );
    expect(echoFirst.turns.map((t) => [t.kind, t.label])).toEqual([
      ["system", "command /rename"],
      ["user", undefined],
    ]);
    expect(echoFirst.turns[0].subtype).toBeUndefined();

    const recordFirst = parseSessionText(
      [systemRecord("local_command", COMMAND_ECHO, 0), userMsg(COMMAND_ECHO, { timestamp: iso(COMMAND_DEDUPE_MS) })].join("\n"),
    );
    expect(recordFirst.turns).toHaveLength(1);
    expect(recordFirst.turns[0]).toMatchObject({ kind: "system", label: "command /rename", subtype: "local_command" });

    // Different command, or the same one later than the window: both stay.
    const other = "<command-name>/compact</command-name>";
    expect(
      parseSessionText([userMsg(COMMAND_ECHO, { timestamp: iso(0) }), systemRecord("local_command", other, 100)].join("\n")).turns,
    ).toHaveLength(2);
    expect(
      parseSessionText(
        [userMsg(COMMAND_ECHO, { timestamp: iso(0) }), systemRecord("local_command", COMMAND_ECHO, COMMAND_DEDUPE_MS + 1)].join("\n"),
      ).turns,
    ).toHaveLength(2);
  });

  it("never counts system records as messages", () => {
    const text = [
      userMsg("hello"),
      systemRecord("away_summary", RECAP),
      systemRecord("informational", "Usage limit reached"),
      systemRecord("scheduled_task_fire", "Running scheduled task"),
      assistantMsg([{ type: "text", text: "ok" }]),
    ].join("\n");
    expect(indexText(text, "/p/-home-me-proj/sess-1.jsonl").messageCount).toBe(2);
    const parsed = parseSessionText(text);
    expect(parsed.turns.filter((t) => t.kind === "user" || t.kind === "assistant")).toHaveLength(2);
    expect(parsed.turns).toHaveLength(5);
  });

  it("exports a recap as a Recap block and notices only with tool results", () => {
    const data: SessionData = {
      meta: {
        sessionId: "abc",
        filePath: "/p/abc.jsonl",
        cwd: "/home/me/proj",
        projectName: "proj",
        title: "T",
        titleSource: "ai",
        messageCount: 1,
        filesChanged: 0,
        mtime: 0,
        size: 0,
      },
      files: [],
      turns: [
        { uuid: "1", role: "user", kind: "user", timestamp: 0, blocks: [{ type: "text", text: "hi" }] },
        { uuid: "2", role: "user", kind: "recap", subtype: "away_summary", timestamp: 0, blocks: [{ type: "text", text: "Goal: x. Next: y." }] },
        { uuid: "3", role: "user", kind: "notice", subtype: "compact_boundary", timestamp: 0, blocks: [{ type: "text", text: "Conversation compacted" }] },
        { uuid: "4", role: "user", kind: "system", subtype: "bridge_status", label: "remote control", timestamp: 0, blocks: [{ type: "text", text: "/remote-control is active" }] },
      ],
    };
    const plain = buildTranscript(data, { includeThinking: false, includeToolResults: false });
    expect(plain).toContain("User:\nhi\n\nRecap:\nGoal: x. Next: y.\n");
    expect(plain).not.toContain("Notice:");
    expect(plain).not.toContain("Conversation compacted");
    expect(plain).not.toContain("remote control");
    const full = buildTranscript(data, { includeThinking: false, includeToolResults: true });
    expect(full).toContain("Recap:\nGoal: x. Next: y.\n\nNotice:\nConversation compacted\n\nSystem (remote control):\n/remote-control is active\n");
  });
});
