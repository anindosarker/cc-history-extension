import type { Block, Turn } from "@shared/types";
import { prettyJson } from "./format";

export type RoleFilter = "all" | "user" | "assistant";

export interface Filters {
  role: RoleFilter;
  showThinking: boolean;
  showTools: boolean;
}

/** A turn after filtering, with only the blocks that will be rendered. */
export interface VisibleTurn {
  turn: Turn;
  index: number;
  blocks: Block[];
}

export interface Match {
  turnIndex: number;
  blockIndex: number;
  /** Occurrence number within the block's searchable text. */
  occ: number;
}

export function applyFilters(turns: Turn[], f: Filters): VisibleTurn[] {
  const out: VisibleTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!t) continue;
    if (f.role !== "all" && t.role !== f.role) continue;
    const blocks = t.blocks.filter((b) => {
      if (b.type === "thinking") return f.showThinking;
      if (b.type === "tool_use") return f.showTools;
      return true;
    });
    if (blocks.length === 0 && t.blocks.length > 0) continue;
    out.push({ turn: t, index: i, blocks });
  }
  return out;
}

/** Text for a tool_use block in render order: chip label, input JSON, result. */
export function toolUseParts(b: Extract<Block, { type: "tool_use" }>): [string, string, string] {
  return [`${b.name} ${b.summary}`, prettyJson(b.input), b.result?.text ?? ""];
}

export function blockText(b: Block): string {
  if (b.type === "text") return b.text;
  if (b.type === "thinking") return b.thinking;
  return toolUseParts(b).join("\n");
}

export function countOccurrences(text: string, query: string): number {
  if (!query) return 0;
  const hay = text.toLowerCase();
  const q = query.toLowerCase();
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(q, i)) !== -1) {
    n++;
    i += q.length;
  }
  return n;
}

export function findMatches(visible: VisibleTurn[], query: string): Match[] {
  const out: Match[] = [];
  if (!query) return out;
  for (let ti = 0; ti < visible.length; ti++) {
    const v = visible[ti];
    for (let bi = 0; bi < v.blocks.length; bi++) {
      const n = countOccurrences(blockText(v.blocks[bi]), query);
      for (let k = 0; k < n; k++) out.push({ turnIndex: ti, blockIndex: bi, occ: k });
    }
  }
  return out;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
