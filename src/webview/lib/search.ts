import type { Block, Turn } from "@shared/types";
import { formatDuration, prettyJson } from "./format";

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

/** An assistant turn that only calls tools and thinks: no text block at all. */
export function isWorkTurn(t: Turn): boolean {
  return t.kind === "assistant" && !t.blocks.some((b) => b.type === "text");
}

export function applyFilters(turns: Turn[], f: Filters): VisibleTurn[] {
  const out: VisibleTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!t) continue;
    if (f.role !== "all" && t.kind !== f.role) continue;
    // Injected system records are noise of the same class as tool calls.
    if (t.kind === "system" && !f.showTools) continue;
    // Hiding tool calls hides the whole "Worked for" fold, including its thinking.
    if (!f.showTools && isWorkTurn(t)) continue;
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

/** A run of consecutive tool-only assistant turns, shown as one "Worked for 4m" line until opened. */
export interface FoldRow {
  kind: "fold";
  key: string;
  items: VisibleTurn[];
  /** Index into the visible list of the first folded turn. */
  firstVisible: number;
  toolCalls: number;
  durationMs: number;
  /** Whether the current search hits something inside the fold. */
  hasMatch: boolean;
  /** Open when the user said so, or by default when a search hit lives inside. */
  open: boolean;
}

export interface TurnRowModel {
  kind: "turn";
  key: string;
  item: VisibleTurn;
  /** Index into the visible list. */
  visibleIndex: number;
}

export type Row = FoldRow | TurnRowModel;

export interface RowModel {
  rows: Row[];
  /** Row index for each visible turn index. */
  rowOf: number[];
}

/**
 * Group each maximal run of tool-only assistant turns into one fold row. A run of one still
 * folds so the list stays uniform; anything else (user, agent, system, assistant text) breaks it.
 * `expanded` holds explicit user choices keyed by fold key.
 */
export function buildRows(visible: VisibleTurn[], matches: Match[], expanded: ReadonlyMap<string, boolean>): RowModel {
  const matched = new Set<number>();
  for (const m of matches) matched.add(m.turnIndex);
  const rows: Row[] = [];
  const rowOf: number[] = new Array(visible.length);
  let i = 0;
  while (i < visible.length) {
    const v = visible[i];
    if (!isWorkTurn(v.turn)) {
      rowOf[i] = rows.length;
      rows.push({ kind: "turn", key: v.turn.uuid, item: v, visibleIndex: i });
      i++;
      continue;
    }
    const start = i;
    let toolCalls = 0;
    let hasMatch = false;
    while (i < visible.length && isWorkTurn(visible[i].turn)) {
      for (const b of visible[i].turn.blocks) if (b.type === "tool_use") toolCalls++;
      if (matched.has(i)) hasMatch = true;
      rowOf[i] = rows.length;
      i++;
    }
    const items = visible.slice(start, i);
    const key = `fold:${v.turn.uuid}`;
    const first = items[0].turn.timestamp;
    const last = items[items.length - 1].turn.timestamp;
    rows.push({
      kind: "fold",
      key,
      items,
      firstVisible: start,
      toolCalls,
      durationMs: Math.max(0, last - first),
      hasMatch,
      open: expanded.get(key) ?? hasMatch,
    });
  }
  return { rows, rowOf };
}

/** "42s" under a minute, then "4m", "1h 5m". */
export function formatWorkDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return formatDuration(ms);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
