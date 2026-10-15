import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTranscript } from "../src/extension/exporter";
import { parseSessionText } from "../src/extension/parser";
import {
  agentIdFromFileName,
  computeAgentStatus,
  listSubagents,
  mergedFileChanges,
  nameFromFileName,
  readTranscriptEdges,
  subagentsDir,
} from "../src/extension/subagents";
import type { SessionMeta } from "../src/shared/types";
import { assistantMsg, line, readResult, toolResult, toolUse, userMsg } from "./fixtures";

const sidechain = { isSidechain: true, agentId: "x" };
const T0 = "2026-01-02T10:00:00.000Z";
const T1 = "2026-01-02T10:05:00.000Z";

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

describe("subagent naming", () => {
  it("derives the name from the file name and falls back for hash-only names", () => {
    expect(nameFromFileName("agent-asia-backend-c8111228980700ba.jsonl")).toBe("sia-backend");
    expect(nameFromFileName("/x/agent-aours-source-cycle-fix-f2135cd02009173f.jsonl")).toBe("ours-source-cycle-fix");
    expect(nameFromFileName("agent-ab2237253bd420b53.jsonl")).toBeUndefined();
    expect(agentIdFromFileName("agent-ab2237253bd420b53.jsonl")).toBe("ab2237253bd420b53");
    expect(agentIdFromFileName("agent-asia-backend-c8111228980700ba.jsonl")).toBe("asia-backend-c8111228980700ba");
  });

  it("locates the subagents folder next to the session log", () => {
    expect(subagentsDir({ filePath: "/p/-home-me-proj/sess.jsonl", sessionId: "sess" })).toBe(
      path.join("/p/-home-me-proj", "sess", "subagents"),
    );
  });

  it("is running only while the parent is alive and the log is fresh", () => {
    const now = 1_000_000_000;
    expect(computeAgentStatus({ endedAt: now - 60_000, now, parentAlive: true })).toBe("running");
    expect(computeAgentStatus({ endedAt: now - 60_000, now, parentAlive: false })).toBe("done");
    expect(computeAgentStatus({ endedAt: now - 3 * 60_000, now, parentAlive: true })).toBe("done");
    expect(computeAgentStatus({ endedAt: undefined, now, parentAlive: true })).toBe("done");
  });
});

describe("subagent listing from a fixture folder", () => {
  let root: string;
  let sessionFile: string;
  const transcript = [
    userMsg("Write browser helper scripts for the harness", { ...sidechain, timestamp: T0 }),
    assistantMsg([{ type: "text", text: "On it." }], { ...sidechain, timestamp: T1 }),
  ].join("\n");

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-history-subagents-"));
    const projectDir = path.join(root, "-home-me-proj");
    const dir = path.join(projectDir, "sess-1", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    sessionFile = path.join(projectDir, "sess-1.jsonl");
    fs.writeFileSync(sessionFile, userMsg("main prompt"));
    fs.writeFileSync(path.join(dir, "agent-ascripts-agent-0123456789abcdef.jsonl"), transcript + "\n");
    fs.writeFileSync(
      path.join(dir, "agent-ascripts-agent-0123456789abcdef.meta.json"),
      JSON.stringify({
        agentType: "scripts-agent",
        description: "Write browser helper scripts",
        name: "scripts-agent",
        model: "claude-fable-5-1",
        color: "blue",
        toolUseId: "toolu_01",
      }),
    );
    // Older agent: hash-only name, no meta.json at all.
    fs.writeFileSync(path.join(dir, "agent-ab2237253bd420b53.jsonl"), transcript + "\n");
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists agents from meta.json plus a stat, oldest first, without parsing transcripts", async () => {
    const list = await listSubagents(meta(sessionFile, "sess-1"), { now: Date.parse(T1) + 60_000, parentAlive: true });
    expect(list).toHaveLength(2);
    const named = list.find((a) => a.agentId === "ascripts-agent-0123456789abcdef");
    expect(named).toMatchObject({
      name: "scripts-agent",
      description: "Write browser helper scripts",
      model: "claude-fable-5-1",
      color: "blue",
      toolUseId: "toolu_01",
      status: "running",
      startedAt: Date.parse(T0),
      endedAt: Date.parse(T1),
    });
    expect(named?.size).toBeGreaterThan(0);
    expect(named?.filePath.endsWith("agent-ascripts-agent-0123456789abcdef.jsonl")).toBe(true);
  });

  it("derives name and description for an agent without meta.json", async () => {
    const list = await listSubagents(meta(sessionFile, "sess-1"), { now: Date.parse(T1) + 60_000, parentAlive: false });
    const bare = list.find((a) => a.agentId === "ab2237253bd420b53");
    expect(bare?.name).toBe("ab2237253bd420b53");
    expect(bare?.description).toBe("Write browser helper scripts for the harness");
    expect(bare?.status).toBe("done");
    expect(bare?.model).toBeUndefined();
  });

  it("returns an empty list when the session has no subagents folder", async () => {
    expect(await listSubagents(meta(sessionFile, "other"), { parentAlive: false })).toEqual([]);
  });

  it("reads timestamps from both ends of a transcript", async () => {
    const file = path.join(path.dirname(sessionFile), "sess-1", "subagents", "agent-ab2237253bd420b53.jsonl");
    const edges = await readTranscriptEdges(file, fs.statSync(file).size);
    expect(edges.startedAt).toBe(Date.parse(T0));
    expect(edges.endedAt).toBe(Date.parse(T1));
    expect(edges.firstPrompt).toBe("Write browser helper scripts for the harness");
  });
});

describe("subagent transcripts through the parser", () => {
  it("keeps sidechain records only when asked and tags turns with the agent name", () => {
    const text = [
      userMsg("prompt", sidechain),
      assistantMsg([{ type: "text", text: "reply" }], sidechain),
    ].join("\n");
    expect(parseSessionText(text).turns).toHaveLength(0);
    const parsed = parseSessionText(text, { sidechain: true, agent: "scripts-agent" });
    expect(parsed.turns.map((t) => t.kind)).toEqual(["user", "assistant"]);
    expect(parsed.turns.every((t) => t.agent === "scripts-agent")).toBe(true);
  });

  it("sums input, output and cache tokens once per assistant message id", () => {
    const usage = (input: number, output: number, read = 0, create = 0) => ({
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: read,
      cache_creation_input_tokens: create,
    });
    const text = [
      userMsg("prompt", sidechain),
      // Two streamed records of one message carry the same usage; count it once.
      line({ ...JSON.parse(assistantMsg([{ type: "text", text: "a" }], sidechain, "m1")), message: { id: "m1", role: "assistant", content: [{ type: "text", text: "a" }], usage: usage(10, 20, 1000, 500) } }),
      line({ ...JSON.parse(assistantMsg([{ type: "text", text: "b" }], sidechain, "m1")), message: { id: "m1", role: "assistant", content: [{ type: "text", text: "b" }], usage: usage(10, 20, 1000, 500) } }),
      line({ ...JSON.parse(assistantMsg([{ type: "text", text: "c" }], sidechain, "m2")), message: { id: "m2", role: "assistant", content: [{ type: "text", text: "c" }], usage: usage(5, 5) } }),
    ].join("\n");
    const parsed = parseSessionText(text, { sidechain: true });
    expect(parsed.tokens).toBe(10 + 20 + 1000 + 500 + 5 + 5);
  });
});

describe("file changes across the main and subagent logs", () => {
  it("merges edits in timestamp order and tags hunks and files with the agent", () => {
    const main = parseSessionText(
      [
        assistantMsg([toolUse("r1", "Read", { file_path: "/a.ts" })], { timestamp: "2026-01-02T10:00:00.000Z" }),
        readResult("r1", "one\ntwo\n"),
        assistantMsg([toolUse("e1", "Edit", { file_path: "/a.ts", old_string: "one", new_string: "ONE" })], {
          timestamp: "2026-01-02T10:01:00.000Z",
        }),
        toolResult("e1", "ok"),
      ].join("\n"),
    ).turns;
    const agent = parseSessionText(
      [
        assistantMsg([toolUse("e2", "Edit", { file_path: "/a.ts", old_string: "two", new_string: "TWO" })], {
          ...sidechain,
          timestamp: "2026-01-02T10:02:00.000Z",
        }),
        toolResult("e2", "ok"),
        assistantMsg([toolUse("w1", "Write", { file_path: "/b.ts", content: "fresh\n" })], {
          ...sidechain,
          timestamp: "2026-01-02T10:03:00.000Z",
        }),
        toolResult("w1", "ok"),
      ].join("\n"),
      { sidechain: true, agent: "scripts-agent" },
    ).turns;
    const files = mergedFileChanges(main, [agent]);
    expect(files.map((f) => f.path).sort()).toEqual(["/a.ts", "/b.ts"]);
    const a = files.find((f) => f.path === "/a.ts")!;
    expect(a.partial).toBe(false);
    expect(a.after).toBe("ONE\nTWO\n");
    expect(a.hunks.map((h) => h.agent)).toEqual([undefined, "scripts-agent"]);
    expect(a.agents).toEqual(["scripts-agent"]);
    const b = files.find((f) => f.path === "/b.ts")!;
    expect(b.agents).toEqual(["scripts-agent"]);
    expect(b.hunks[0].agent).toBe("scripts-agent");
  });
});

describe("agent export heading", () => {
  it("replaces the title line with the agent heading", () => {
    const parsed = parseSessionText(
      [userMsg("prompt", sidechain), assistantMsg([{ type: "text", text: "reply" }], sidechain)].join("\n"),
      { sidechain: true, agent: "scripts-agent" },
    );
    const text = buildTranscript(
      { meta: meta("/p/s.jsonl", "s"), turns: parsed.turns, files: [] },
      { includeThinking: false, includeToolResults: false, heading: "# Agent: scripts-agent (Write scripts)" },
    );
    expect(text.startsWith("# Agent: scripts-agent (Write scripts)\n")).toBe(true);
    expect(text).toContain("User:\nprompt\n\nAssistant:\nreply\n");
  });
});
