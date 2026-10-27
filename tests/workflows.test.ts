import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSubagents } from "../src/extension/subagents";
import { listWorkflowRuns, parseJournal, workflowAgentsDir, workflowsDir } from "../src/extension/workflows";
import type { SessionMeta } from "../src/shared/types";
import { assistantMsg, line, userMsg } from "./fixtures";

const T0 = "2026-01-02T10:00:00.000Z";
const T1 = "2026-01-02T10:05:00.000Z";
const T2 = "2026-01-02T11:00:00.000Z";
const T3 = "2026-01-02T11:01:00.000Z";

function meta(filePath: string, sessionId: string): SessionMeta {
  return {
    sessionId,
    filePath,
    cwd: "/home/me/proj",
    projectName: "proj",
    title: "T",
    titleSource: "ai",
    messageCount: 1,
    filesChanged: 0,
    mtime: 0,
    size: 0,
  };
}

function transcript(prompt: string, start: string, end: string, extra: Record<string, unknown> = {}): string {
  const sc = { isSidechain: true, agentId: "x" };
  return [userMsg(prompt, { ...sc, timestamp: start }), assistantMsg([{ type: "text", text: "ok" }], { ...sc, timestamp: end, ...extra })].join("\n") + "\n";
}

function writeAgent(dir: string, id: string, description: string, phase: string | undefined, start: string, end: string): void {
  fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), transcript(`Do ${description}`, start, end));
  const m: Record<string, unknown> = { agentType: "workflow-subagent", description };
  if (phase) m.workflowPhase = phase;
  fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(m));
}

describe("workflow journal", () => {
  it("keeps start order, phases as first seen, and finished or failed agents", () => {
    const j = parseJournal(
      [
        line({ type: "launched" }),
        line({ type: "started", agentId: "a2", label: "review:01", phase: "Review" }),
        line({ type: "started", agentId: "a1", label: "code:01", phase: "Code" }),
        line({ type: "result", agentId: "a2", result: { summary: "s" } }),
        line({ type: "failed", agentId: "a1" }),
        "not json",
      ].join("\n"),
    );
    expect(j.order).toEqual(["a2", "a1"]);
    expect(j.phases).toEqual(["Review", "Code"]);
    expect([...j.results]).toEqual(["a2"]);
    expect([...j.failed]).toEqual(["a1"]);
  });
});

describe("workflow runs from a fixture folder", () => {
  let root: string;
  let sessionFile: string;
  let m: SessionMeta;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-workflows-"));
    const projectDir = path.join(root, "-home-me-proj");
    sessionFile = path.join(projectDir, "sess-1.jsonl");
    m = meta(sessionFile, "sess-1");
    const direct = path.join(projectDir, "sess-1", "subagents");
    fs.mkdirSync(direct, { recursive: true });
    fs.writeFileSync(sessionFile, userMsg("main prompt"));
    fs.writeFileSync(path.join(direct, "agent-adirect-0123456789abcdef.jsonl"), transcript("Direct helper", T0, T1));

    // Ended run: run file plus agents, listed out of phase order on disk.
    fs.mkdirSync(workflowsDir(m), { recursive: true });
    fs.writeFileSync(
      path.join(workflowsDir(m), "wf_done-001.json"),
      JSON.stringify({
        runId: "wf_done-001",
        workflowName: "part-07",
        summary: "coder, reviewer, gate",
        status: "completed",
        startTime: Date.parse(T0),
        durationMs: 3_240_000,
        phases: [{ title: "Code" }, { title: "Review" }, { title: "Gate" }],
        agentCount: 4,
        totalTokens: 466_478,
        totalToolCalls: 103,
        defaultModel: "claude-fable-5-1",
        script: "export const meta = {}",
      }),
    );
    const done = path.join(workflowAgentsDir(m), "wf_done-001");
    fs.mkdirSync(done, { recursive: true });
    writeAgent(done, "a03", "gate:07", "Gate", T0, T1);
    writeAgent(done, "a02", "review:07", "Review", T0, T1);
    writeAgent(done, "a01", "code:07", "Code", T0, T1);
    writeAgent(done, "a04", "stray", undefined, T0, T1);
    fs.writeFileSync(
      path.join(done, "journal.jsonl"),
      [
        line({ type: "launched" }),
        line({ type: "started", agentId: "a01", label: "code:07", phase: "Code" }),
        line({ type: "started", agentId: "a02", label: "review:07", phase: "Review" }),
        line({ type: "failed", agentId: "a02" }),
        line({ type: "started", agentId: "a03", label: "gate:07", phase: "Gate" }),
        line({ type: "result", agentId: "a03" }),
      ].join("\n") + "\n",
    );

    // Live run: journal and agents, no run file yet.
    const live = path.join(workflowAgentsDir(m), "wf_live-002");
    fs.mkdirSync(live, { recursive: true });
    writeAgent(live, "b02", "verify:2", "Verify", T2, T3);
    writeAgent(live, "b01", "compare:1", "Compare", T2, T3);
    fs.writeFileSync(
      path.join(live, "journal.jsonl"),
      [
        line({ type: "launched" }),
        line({ type: "started", agentId: "b01", label: "compare:1", phase: "Compare" }),
        line({ type: "started", agentId: "b02", label: "verify:2", phase: "Verify" }),
        line({ type: "result", agentId: "b01" }),
      ].join("\n") + "\n",
    );
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists an ended run from its run file with agents grouped by phase, unphased last", async () => {
    const runs = await listWorkflowRuns(m, { now: Date.parse(T3), parentAlive: false });
    const run = runs.find((r) => r.runId === "wf_done-001");
    expect(run).toMatchObject({
      name: "part-07",
      summary: "coder, reviewer, gate",
      status: "completed",
      startedAt: Date.parse(T0),
      durationMs: 3_240_000,
      totalTokens: 466_478,
      totalToolCalls: 103,
      phases: ["Code", "Review", "Gate"],
    });
    expect(run?.agents.map((a) => a.description)).toEqual(["code:07", "review:07", "gate:07", "stray"]);
    expect(run?.agents.map((a) => a.phase)).toEqual(["Code", "Review", "Gate", undefined]);
    expect(run?.agents.every((a) => a.runId === "wf_done-001" && a.model === "claude-fable-5-1")).toBe(true);
    expect(run?.agents.map((a) => a.status)).toEqual(["done", "failed", "done", "done"]);
  });

  it("shows a run without a run file as running while the parent is alive, newest run first", async () => {
    const now = Date.parse(T3) + 30_000;
    const runs = await listWorkflowRuns(m, { now, parentAlive: true });
    expect(runs.map((r) => r.runId)).toEqual(["wf_live-002", "wf_done-001"]);
    const live = runs[0];
    expect(live).toMatchObject({ name: "wf_live-002", status: "running", startedAt: Date.parse(T2), phases: ["Compare", "Verify"] });
    expect(live.durationMs).toBeUndefined();
    // b01 has a result in the journal; b02 is still writing.
    expect(live.agents.map((a) => [a.agentId, a.status])).toEqual([
      ["b01", "done"],
      ["b02", "running"],
    ]);
    // An ended run's agents never show as running.
    expect(runs[1].agents.some((a) => a.status === "running")).toBe(false);
  });

  it("marks a run without a run file unknown once the parent is gone", async () => {
    const runs = await listWorkflowRuns(m, { now: Date.parse(T3), parentAlive: false });
    expect(runs.find((r) => r.runId === "wf_live-002")?.status).toBe("unknown");
  });

  it("keeps workflow agents out of the direct agents list", async () => {
    const direct = await listSubagents(m, { parentAlive: false });
    expect(direct.map((a) => a.agentId)).toEqual(["adirect-0123456789abcdef"]);
    expect(direct[0].runId).toBeUndefined();
  });

  it("returns no runs for a session without workflows", async () => {
    expect(await listWorkflowRuns(meta(sessionFile, "other"), { parentAlive: false })).toEqual([]);
  });
});
