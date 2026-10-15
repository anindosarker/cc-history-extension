import { createContext, useContext } from "react";
import type { Block, SubagentInfo } from "@shared/types";

export interface AgentsContextValue {
  agents: SubagentInfo[];
  openAgent: (agentId: string) => void;
}

export const AgentsContext = createContext<AgentsContextValue>({ agents: [], openAgent: () => {} });

export function useAgents(): AgentsContextValue {
  return useContext(AgentsContext);
}

/**
 * The listed subagent an `Agent` tool call spawned: matched by the recorded tool_use id, then by
 * the `name` input, then by the "agent_id: <name>@..." line in the spawn result.
 */
export function agentForToolUse(
  agents: SubagentInfo[],
  block: Extract<Block, { type: "tool_use" }>,
): SubagentInfo | undefined {
  if (block.name !== "Agent" || agents.length === 0) return undefined;
  const byId = agents.find((a) => a.toolUseId === block.id);
  if (byId) return byId;
  const input = block.input as { name?: unknown } | undefined;
  const inputName = typeof input?.name === "string" ? input.name : undefined;
  if (inputName) {
    const byName = agents.find((a) => a.name === inputName);
    if (byName) return byName;
  }
  const m = block.result ? /agent_id:\s*([^@\s]+)@/.exec(block.result.text) : null;
  if (m) return agents.find((a) => a.name === m[1]);
  return undefined;
}
