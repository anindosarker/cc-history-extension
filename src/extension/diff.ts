import { countLines } from "../shared/editStats";
import type { Block, FileChange, FileHunk, Turn } from "../shared/types";

export { countLines };

type ToolUse = Extract<Block, { type: "tool_use" }>;

interface FileState {
  change: FileChange;
  /** Current reconstructed content, undefined once reconstruction has failed. */
  current: string | undefined;
  /** True until the first edit so a late Read can still seed the "before". */
  untouched: boolean;
}

/**
 * Extract per-file edit history from assistant tool calls.
 * Read results seed the reconstruction so Write and Edit hunks get a real "before".
 */
export function extractFileChanges(turns: Turn[]): FileChange[] {
  const states = new Map<string, FileState>();
  const reads = new Map<string, string>();

  const stateFor = (p: string): FileState => {
    let s = states.get(p);
    if (!s) {
      const known = reads.get(p);
      s = {
        change: { path: p, hunks: [], added: 0, removed: 0, partial: false, before: known ?? "" },
        current: known ?? "",
        untouched: true,
      };
      states.set(p, s);
    }
    return s;
  };

  for (const turn of turns) {
    const agent = turn.agent;
    for (const block of turn.blocks) {
      if (block.type !== "tool_use") continue;
      if (block.result?.isError) continue;
      const input = asObj(block.input);
      if (block.name === "Read") {
        noteRead(block, input, reads, states);
        continue;
      }
      if (block.name === "Edit") {
        const p = str(input.file_path);
        if (!p) continue;
        applyEdit(stateFor(p), block.name, agent, str(input.old_string) ?? "", str(input.new_string) ?? "", input.replace_all === true);
      } else if (block.name === "MultiEdit") {
        const p = str(input.file_path);
        if (!p || !Array.isArray(input.edits)) continue;
        const st = stateFor(p);
        for (const e of input.edits) {
          const eo = asObj(e);
          applyEdit(st, block.name, agent, str(eo.old_string) ?? "", str(eo.new_string) ?? "", eo.replace_all === true);
        }
      } else if (block.name === "Write") {
        const p = str(input.file_path);
        if (!p) continue;
        applyWrite(stateFor(p), block.name, agent, str(input.content) ?? "");
      } else if (block.name === "NotebookEdit") {
        const p = str(input.notebook_path);
        if (!p) continue;
        applyWrite(stateFor(p), block.name, agent, str(input.new_source) ?? "");
      }
    }
  }

  const out: FileChange[] = [];
  for (const st of states.values()) {
    if (st.change.hunks.length === 0) continue;
    if (st.change.partial || st.current === undefined) {
      st.change.partial = true;
      delete st.change.before;
      delete st.change.after;
    } else {
      st.change.after = st.current;
    }
    out.push(st.change);
  }
  return out;
}

function noteRead(
  block: ToolUse,
  input: Record<string, unknown>,
  reads: Map<string, string>,
  states: Map<string, FileState>,
): void {
  const p = str(input.file_path);
  if (!p || !block.result || block.result.truncated) return;
  if (input.offset !== undefined || input.limit !== undefined) return;
  const text = stripLineNumbers(block.result.text);
  reads.set(p, text);
  const st = states.get(p);
  if (!st) return;
  // A fresh full read is ground truth for whatever comes next.
  st.current = text;
  if (st.untouched) st.change.before = text;
}

function applyEdit(
  st: FileState,
  tool: string,
  agent: string | undefined,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): void {
  const hunk: FileHunk = {
    tool,
    ...(agent ? { agent } : {}),
    before: oldStr,
    after: newStr,
    added: countLines(newStr),
    removed: countLines(oldStr),
  };
  pushHunk(st, hunk);
  if (st.current === undefined) return;
  if (oldStr === "" || !st.current.includes(oldStr)) {
    st.change.partial = true;
    st.current = undefined;
    return;
  }
  st.current = replaceAll ? st.current.split(oldStr).join(newStr) : st.current.replace(oldStr, () => newStr);
}

function applyWrite(st: FileState, tool: string, agent: string | undefined, content: string): void {
  const before = st.current ?? "";
  pushHunk(st, {
    tool,
    ...(agent ? { agent } : {}),
    before,
    after: content,
    added: countLines(content),
    removed: countLines(before),
  });
  if (st.current !== undefined) st.current = content;
}

function pushHunk(st: FileState, hunk: FileHunk): void {
  st.untouched = false;
  st.change.hunks.push(hunk);
  if (hunk.agent) {
    const agents = (st.change.agents ??= []);
    if (!agents.includes(hunk.agent)) agents.push(hunk.agent);
  }
  st.change.added += hunk.added;
  st.change.removed += hunk.removed;
}

/** Remove the "   12\t" prefixes the Read tool adds, and any trailing system reminder. */
export function stripLineNumbers(text: string): string {
  const idx = text.indexOf("\n<system-reminder>");
  const body = idx === -1 ? text : text.slice(0, idx);
  const lines = body.split("\n");
  if (!lines.every((l) => l === "" || /^\s*\d+\t/.test(l) || /^\s*\d+→/.test(l))) return body;
  return lines.map((l) => l.replace(/^\s*\d+(\t|→)/, "")).join("\n");
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
