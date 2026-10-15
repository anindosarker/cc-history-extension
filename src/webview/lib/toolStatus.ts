import type { Block } from "@shared/types";

export type ToolStatus = "ok" | "error" | "none";
type ToolUse = Extract<Block, { type: "tool_use" }>;

/** Tools that spawn or talk to other agents; their dot is purple whatever the result. */
export const AGENT_TOOLS = new Set(["Agent", "Task", "SendMessage"]);

export function toolStatus(b: ToolUse): ToolStatus {
  if (!b.result) return "none";
  return b.result.isError ? "error" : "ok";
}

/** Status of a run of tool calls: red when any failed, green when every one succeeded, grey otherwise. */
export function runStatus(blocks: Block[]): ToolStatus {
  let any = false;
  let allOk = true;
  for (const b of blocks) {
    if (b.type !== "tool_use") continue;
    any = true;
    const s = toolStatus(b);
    if (s === "error") return "error";
    if (s !== "ok") allOk = false;
  }
  return any && allOk ? "ok" : "none";
}
