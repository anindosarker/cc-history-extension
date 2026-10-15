import { createContext, useContext } from "react";
import { matchAgent, spawnRefOf } from "@shared/agents";
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
  if (agents.length === 0) return undefined;
  const ref = spawnRefOf(block, 0);
  return ref ? matchAgent(agents, ref) : undefined;
}
