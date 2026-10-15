import type { Block, SubagentInfo, Turn } from "./types";

type AgentLike = Pick<SubagentInfo, "agentId" | "name" | "agentType" | "description" | "model" | "toolUseId">;

/** What a row, link or card shows for an agent, matching Claude Code's own "name  description" list. */
export interface AgentLabel {
  /** The name when the agent has one, otherwise the description. */
  primary: string;
  /** The description after a name; absent when the primary text already is the description. */
  secondary?: string;
  /** Multi-line hover text: the label lines, then the agent type and model when known. */
  tooltip: string;
}

export function agentLabel(a: Pick<SubagentInfo, "name" | "agentType" | "description" | "model">): AgentLabel {
  const lines: string[] = [];
  let primary: string;
  let secondary: string | undefined;
  if (a.name) {
    primary = a.name;
    if (a.description && a.description !== a.name) secondary = a.description;
    lines.push(secondary ? `${primary}  ${secondary}` : primary);
  } else {
    primary = a.description;
    lines.push(primary);
  }
  if (a.agentType) lines.push(`Type: ${a.agentType}`);
  if (a.model) lines.push(a.model);
  return secondary === undefined ? { primary, tooltip: lines.join("\n") } : { primary, secondary, tooltip: lines.join("\n") };
}

/** Short identifier used to tag turns and file edits: the name, else the agent type, else the id. */
export function agentTag(a: Pick<SubagentInfo, "agentId" | "name" | "agentType">): string {
  return a.name ?? a.agentType ?? a.agentId;
}

/** One `Agent` tool call in the main transcript, in the order it was made. */
export interface SpawnRef {
  toolUseId: string;
  /** The `name` input of the call. */
  name?: string;
  /** The name from the "agent_id: <name>@..." line of the call's result. */
  resultName?: string;
  timestamp: number;
}

export function spawnRefOf(block: Extract<Block, { type: "tool_use" }>, timestamp: number): SpawnRef | undefined {
  if (block.name !== "Agent") return undefined;
  const input = block.input as { name?: unknown } | undefined;
  const ref: SpawnRef = { toolUseId: block.id, timestamp };
  if (typeof input?.name === "string" && input.name) ref.name = input.name;
  const m = block.result ? /agent_id:\s*([^@\s]+)@/.exec(block.result.text) : null;
  if (m) ref.resultName = m[1];
  return ref;
}

/** Every `Agent` tool call of a transcript, first spawned first. */
export function spawnOrder(turns: readonly Turn[]): SpawnRef[] {
  const out: SpawnRef[] = [];
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const b of t.blocks) {
      if (b.type !== "tool_use") continue;
      const ref = spawnRefOf(b, t.timestamp);
      if (ref) out.push(ref);
    }
  }
  return out;
}

/**
 * The listed subagent a spawn call started: matched by the recorded tool_use id, then by the
 * `name` input, then by the "agent_id: <name>@..." line in the spawn result.
 */
export function matchAgent<T extends AgentLike>(agents: readonly T[], ref: SpawnRef): T | undefined {
  const byId = agents.find((a) => a.toolUseId === ref.toolUseId);
  if (byId) return byId;
  if (ref.name) {
    const byName = agents.find((a) => a.name === ref.name);
    if (byName) return byName;
  }
  if (ref.resultName) return agents.find((a) => a.name === ref.resultName);
  return undefined;
}

/**
 * Agents in spawn order: the order of the `Agent` tool calls that started them. Agents no call
 * matches fall back to their start time, interleaved with the matched ones by the call's time.
 */
export function orderAgents<T extends AgentLike & { startedAt?: number; endedAt?: number }>(
  agents: readonly T[],
  refs: readonly SpawnRef[],
): T[] {
  const spawn = new Map<string, { index: number; timestamp: number }>();
  refs.forEach((ref, index) => {
    const a = matchAgent(agents, ref);
    if (a && !spawn.has(a.agentId)) spawn.set(a.agentId, { index, timestamp: ref.timestamp });
  });
  const key = (a: T) => {
    const s = spawn.get(a.agentId);
    const fallback = a.startedAt ?? a.endedAt ?? 0;
    return s ? { ts: s.timestamp || fallback, index: s.index } : { ts: fallback, index: Number.POSITIVE_INFINITY };
  };
  return agents
    .map((a, i) => ({ a, i, k: key(a) }))
    .sort((x, y) => x.k.ts - y.k.ts || x.k.index - y.k.index || x.i - y.i)
    .map((x) => x.a);
}

/** Names of agents whose idle notification in the main transcript reported a failure. */
export function failedAgentNames(turns: readonly Turn[]): Set<string> {
  const out = new Set<string>();
  for (const t of turns) if (t.kind === "agent" && t.failed && t.agentName) out.add(t.agentName);
  return out;
}
