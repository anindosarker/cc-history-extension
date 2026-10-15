import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentLabel, agentTag, failedAgentNames, orderAgents, spawnOrder } from "../src/shared/agents";
import type { SessionMeta, SubagentInfo, Turn } from "../src/shared/types";
import { parseSessionText } from "../src/extension/parser";
import { listSubagents, readTranscriptEdges } from "../src/extension/subagents";
import { assistantMsg, toolResult, toolUse, userMsg } from "./fixtures";

function info(agentId: string, extra: Partial<SubagentInfo> = {}): SubagentInfo {
  return { agentId, description: `desc ${agentId}`, filePath: `/x/${agentId}.jsonl`, size: 1, status: "done", ...extra };
}

describe("agent labels", () => {
  it("leads with the name and keeps the description as secondary text", () => {
    const l = agentLabel({ name: "builder6", description: "Tree: current project first, sort options", agentType: "general-purpose", model: "claude-fable-5-1" });
    expect(l.primary).toBe("builder6");
    expect(l.secondary).toBe("Tree: current project first, sort options");
    expect(l.tooltip).toBe("builder6  Tree: current project first, sort options\nType: general-purpose\nclaude-fable-5-1");
  });

  it("shows only the description for an unnamed agent and moves the type to the tooltip", () => {
    const l = agentLabel({ description: "Find the config loader", agentType: "general-purpose" });
    expect(l.primary).toBe("Find the config loader");
    expect(l.secondary).toBeUndefined();
    expect(l.tooltip).toBe("Find the config loader\nType: general-purpose");
  });

  it("does not repeat a description equal to the name", () => {
    expect(agentLabel({ name: "x", description: "x" })).toEqual({ primary: "x", tooltip: "x" });
  });

  it("tags turns with the name, else the type, else the id", () => {
    expect(agentTag({ agentId: "ab12", name: "n", agentType: "t" })).toBe("n");
    expect(agentTag({ agentId: "ab12", agentType: "t" })).toBe("t");
    expect(agentTag({ agentId: "ab12" })).toBe("ab12");
  });
});

describe("spawn order", () => {
  const t = (uuid: string, timestamp: number, blocks: Turn["blocks"]): Turn => ({ uuid, role: "assistant", kind: "assistant", timestamp, blocks });
  const agentCall = (id: string, name?: string, resultText?: string) => ({
    type: "tool_use" as const,
    id,
    name: "Agent",
    input: name ? { name, prompt: "p" } : { prompt: "p" },
    summary: "p",
    ...(resultText ? { result: { text: resultText, isError: false } } : {}),
  });
  const turns: Turn[] = [
    t("a1", 1000, [agentCall("tu1", "second")]),
    t("a2", 2000, [agentCall("tu2"), agentCall("tu3", undefined, "agent_id: third@abc")]),
    t("a3", 3000, [{ type: "tool_use", id: "tu4", name: "Bash", input: {}, summary: "ls" }]),
  ];

  it("collects Agent calls in transcript order with their matching hints", () => {
    expect(spawnOrder(turns)).toEqual([
      { toolUseId: "tu1", name: "second", timestamp: 1000 },
      { toolUseId: "tu2", timestamp: 2000 },
      { toolUseId: "tu3", resultName: "third", timestamp: 2000 },
    ]);
  });

  it("orders agents by their spawn call, matched by tool_use id, name input or result line", () => {
    const agents = [
      info("c", { name: "third", startedAt: 2500 }),
      info("b", { toolUseId: "tu2", startedAt: 2400 }),
      info("a", { name: "second", startedAt: 1500 }),
    ];
    expect(orderAgents(agents, spawnOrder(turns)).map((a) => a.agentId)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the start time for agents no call matches, interleaved by time", () => {
    const agents = [
      info("late", { startedAt: 5000 }),
      info("b", { toolUseId: "tu2", startedAt: 2400 }),
      info("early", { startedAt: 500 }),
      info("a", { name: "second", startedAt: 1500 }),
    ];
    expect(orderAgents(agents, spawnOrder(turns)).map((a) => a.agentId)).toEqual(["early", "a", "b", "late"]);
    expect(orderAgents(agents, []).map((a) => a.agentId)).toEqual(["early", "a", "b", "late"]);
  });
});

describe("failed agents", () => {
  const wrap = (name: string, payload: unknown) =>
    userMsg(`<teammate-message teammate_id="${name}">${JSON.stringify(payload)}</teammate-message>`);

  it("marks the turn and collects the names from failed idle notifications only", () => {
    const parsed = parseSessionText(
      [
        wrap("ok-agent", { type: "idle_notification", idleReason: "available" }),
        wrap("bad-agent", { type: "idle_notification", idleReason: "failed" }),
        wrap("worse-agent", { type: "idle_notification", failureReason: "hit the session limit" }),
        wrap("done-agent", { type: "idle_notification", result: "all good" }),
      ].join("\n"),
    );
    expect(parsed.turns.map((t) => t.failed ?? false)).toEqual([false, true, true, false]);
    expect([...failedAgentNames(parsed.turns)].sort()).toEqual(["bad-agent", "worse-agent"]);
  });
});

describe("listing with the main transcript", () => {
  let root: string;
  let sessionFile: string;
  const T0 = "2026-01-02T10:00:00.000Z";
  const T1 = "2026-01-02T10:05:00.000Z";
  const sidechain = { isSidechain: true, timestamp: T0 };
  const okTranscript = [userMsg("do a", sidechain), assistantMsg([{ type: "text", text: "done" }], { ...sidechain, timestamp: T1 })].join("\n") + "\n";
  // Starts after the spawn calls in the main transcript, so it sorts after the matched agents.
  const errTranscript =
    [
      userMsg("do b", { ...sidechain, timestamp: "2026-01-02T10:02:00.000Z" }),
      assistantMsg([{ type: "text", text: "boom" }], { ...sidechain, timestamp: T1, message: { id: "m9", role: "assistant", content: [{ type: "text", text: "boom" }], stop_reason: "error", usage: {} } }),
    ].join("\n") + "\n";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-agent-order-"));
    const projectDir = path.join(root, "-home-me-proj");
    const dir = path.join(projectDir, "sess-1", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(projectDir, "sess-1.jsonl");
    fs.writeFileSync(sessionFile, userMsg("main"));
    fs.writeFileSync(path.join(dir, "agent-aalpha-0123456789abcdef.jsonl"), okTranscript);
    fs.writeFileSync(path.join(dir, "agent-aalpha-0123456789abcdef.meta.json"), JSON.stringify({ name: "alpha", description: "A", toolUseId: "tu-alpha" }));
    fs.writeFileSync(path.join(dir, "agent-abeta-0123456789abcdef.jsonl"), okTranscript);
    fs.writeFileSync(path.join(dir, "agent-abeta-0123456789abcdef.meta.json"), JSON.stringify({ name: "beta", description: "B", toolUseId: "tu-beta" }));
    fs.writeFileSync(path.join(dir, "agent-ab2237253bd420b53.jsonl"), errTranscript);
    fs.writeFileSync(path.join(dir, "agent-ab2237253bd420b53.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "C" }));
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function meta(): SessionMeta {
    return { sessionId: "sess-1", filePath: sessionFile, cwd: "/home/me/proj", projectName: "proj", title: "T", titleSource: "ai", messageCount: 1, filesChanged: 0, mtime: 0, size: 0 };
  }

  it("reads the last assistant stop_reason from the tail", async () => {
    const p = path.join(path.dirname(sessionFile), "sess-1", "subagents", "agent-ab2237253bd420b53.jsonl");
    expect((await readTranscriptEdges(p, fs.statSync(p).size)).lastStopReason).toBe("error");
  });

  it("orders by the main transcript's Agent calls and marks failures from idle notifications and stop_reason", async () => {
    const main = parseSessionText(
      [
        userMsg("go"),
        assistantMsg([toolUse("tu-beta", "Agent", { name: "beta", prompt: "B" }), toolUse("tu-alpha", "Agent", { name: "alpha", prompt: "A" })], {}, "m1"),
        toolResult("tu-beta", "ok"),
        userMsg('<teammate-message teammate_id="alpha">{"type":"idle_notification","idleReason":"failed"}</teammate-message>'),
      ].join("\n"),
    );
    const list = await listSubagents(meta(), { now: Date.parse(T1) + 60_000, parentAlive: true, mainTurns: main.turns });
    expect(list.map((a) => a.name)).toEqual(["beta", "alpha", undefined]);
    expect(list.map((a) => a.status)).toEqual(["running", "failed", "failed"]);
    expect(list[2].agentType).toBe("general-purpose");
    expect(list[2].description).toBe("C");
  });
});
