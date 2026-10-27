import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionMeta, SubagentInfo, WorkflowRun } from "../shared/types";
import { tryParseJson } from "./jsonl";
import { asRecord } from "./records";
import { agentIdFromFileName, readAgentFile, str, subagentsDir } from "./subagents";

/** `<projectDir>/<sessionId>/workflows`: one `<runId>.json` per ended run. */
export function workflowsDir(meta: Pick<SessionMeta, "filePath" | "sessionId">): string {
  return path.join(path.dirname(meta.filePath), meta.sessionId, "workflows");
}

/** `<projectDir>/<sessionId>/subagents/workflows`: one folder of agent transcripts and a journal per run. */
export function workflowAgentsDir(meta: Pick<SessionMeta, "filePath" | "sessionId">): string {
  return path.join(subagentsDir(meta), "workflows");
}

/** The fields of workflows/<runId>.json this view uses; the file also holds the script, args and logs. */
interface RunFile {
  workflowName?: string;
  summary?: string;
  status?: string;
  startTime?: number;
  durationMs?: number;
  phases?: { title?: string }[];
  totalTokens?: number;
  totalToolCalls?: number;
  defaultModel?: string;
}

/** What the journal says about a run: start order, phases as first seen, and finished or failed agents. */
export interface Journal {
  order: string[];
  phases: string[];
  results: Set<string>;
  failed: Set<string>;
}

/** journal.jsonl events: `started {agentId,label,phase}`, `result {agentId}`, `failed {agentId}`. */
export function parseJournal(text: string): Journal {
  const out: Journal = { order: [], phases: [], results: new Set(), failed: new Set() };
  for (const line of text.split("\n")) {
    const ev = asRecord(tryParseJson(line));
    const agentId = str(ev?.agentId);
    if (!ev || !agentId) continue;
    if (ev.type === "started") {
      if (!out.order.includes(agentId)) out.order.push(agentId);
      const phase = str((ev as { phase?: unknown }).phase);
      if (phase && !out.phases.includes(phase)) out.phases.push(phase);
    } else if (ev.type === "result") {
      out.results.add(agentId);
    } else if (ev.type === "failed") {
      out.failed.add(agentId);
    }
  }
  return out;
}

export interface WorkflowListOptions {
  now?: number;
  /** Whether the parent session still has a live Claude process. */
  parentAlive: boolean;
}

/**
 * Workflow runs of a session, newest first. A run is listed when it has a run file or an agent
 * folder; its agents come from the same meta.json and transcript edges as the direct subagents.
 */
export async function listWorkflowRuns(meta: SessionMeta, opts: WorkflowListOptions): Promise<WorkflowRun[]> {
  const runsDir = workflowsDir(meta);
  const agentsRoot = workflowAgentsDir(meta);
  const ids = new Set<string>();
  for (const name of await readdirSafe(runsDir)) if (name.startsWith("wf_") && name.endsWith(".json")) ids.add(name.slice(0, -".json".length));
  for (const name of await readdirSafe(agentsRoot)) if (name.startsWith("wf_")) ids.add(name);
  const now = opts.now ?? Date.now();
  const runs: WorkflowRun[] = [];
  for (const runId of ids) {
    const run = await readRun(runId, runsDir, path.join(agentsRoot, runId), now, opts.parentAlive);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || b.runId.localeCompare(a.runId));
  return runs;
}

async function readRun(runId: string, runsDir: string, dir: string, now: number, parentAlive: boolean): Promise<WorkflowRun | undefined> {
  let file: RunFile | undefined;
  try {
    const v = asRecord(JSON.parse(await fs.promises.readFile(path.join(runsDir, runId + ".json"), "utf8")));
    if (v) file = v as RunFile;
  } catch {
    /* no run file yet: the run is live or never finished */
  }
  let journal: Journal = { order: [], phases: [], results: new Set(), failed: new Set() };
  try {
    journal = parseJournal(await fs.promises.readFile(path.join(dir, "journal.jsonl"), "utf8"));
  } catch {
    /* no journal */
  }
  const names = await readdirSafe(dir);
  if (!file && names.length === 0) return undefined;

  const status = str(file?.status) ?? (parentAlive ? "running" : "unknown");
  const running = status === "running" && parentAlive;
  const agents: SubagentInfo[] = [];
  for (const name of names) {
    // journal.jsonl sits next to the transcripts.
    if (!name.startsWith("agent-")) continue;
    const agentId = agentIdFromFileName(name);
    const info = await readAgentFile(dir, name, {
      now,
      parentAlive: running && !journal.results.has(agentId),
      failedIds: journal.failed,
    });
    if (!info) continue;
    info.runId = runId;
    if (!info.model && str(file?.defaultModel)) info.model = file!.defaultModel;
    agents.push(info);
  }

  const phases: string[] = [];
  for (const p of file?.phases ?? []) if (str(p?.title) && !phases.includes(p.title!)) phases.push(p.title!);
  for (const p of journal.phases) if (!phases.includes(p)) phases.push(p);
  for (const a of agents) if (a.phase && !phases.includes(a.phase)) phases.push(a.phase);
  sortRunAgents(agents, phases, journal.order);

  const startTime = typeof file?.startTime === "number" ? file.startTime : undefined;
  const run: WorkflowRun = {
    runId,
    name: str(file?.workflowName) ?? runId,
    status,
    phases,
    agents,
  };
  const startedAt = startTime ?? minStart(agents);
  if (startedAt !== undefined) run.startedAt = startedAt;
  if (str(file?.summary)) run.summary = file!.summary;
  if (typeof file?.durationMs === "number") run.durationMs = file.durationMs;
  if (typeof file?.totalTokens === "number") run.totalTokens = file.totalTokens;
  if (typeof file?.totalToolCalls === "number") run.totalToolCalls = file.totalToolCalls;
  return run;
}

/** Phase order first, unphased last; within a phase the journal's start order, then start time. */
export function sortRunAgents(agents: SubagentInfo[], phases: readonly string[], order: readonly string[]): void {
  const phaseRank = (a: SubagentInfo) => {
    const i = a.phase ? phases.indexOf(a.phase) : -1;
    return i === -1 ? phases.length : i;
  };
  const startRank = (a: SubagentInfo) => {
    const i = order.indexOf(a.agentId);
    return i === -1 ? order.length : i;
  };
  agents.sort(
    (a, b) =>
      phaseRank(a) - phaseRank(b) ||
      startRank(a) - startRank(b) ||
      (a.startedAt ?? a.endedAt ?? 0) - (b.startedAt ?? b.endedAt ?? 0) ||
      a.agentId.localeCompare(b.agentId),
  );
}

function minStart(agents: readonly SubagentInfo[]): number | undefined {
  let min: number | undefined;
  for (const a of agents) if (a.startedAt !== undefined && (min === undefined || a.startedAt < min)) min = a.startedAt;
  return min;
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dir);
  } catch {
    return [];
  }
}
