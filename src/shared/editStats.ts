/** Line math shared by the Files tab (host) and the tool lines (webview) so their numbers agree. */

export function countLines(s: string): number {
  if (s === "") return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  if (s.endsWith("\n")) n--;
  return n;
}

export interface EditCounts {
  added: number;
  /** Absent for a Write, whose replaced content is only known from the file history. */
  removed?: number;
}

/** One replaced-by pair of an edit, as lines. */
export interface EditLines {
  removed: string[];
  added: string[];
}

/** Lines of a Write shown in a mini diff before the rest is summarized as "… N more". */
export const WRITE_PREVIEW_LINES = 200;

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Old/new string pairs of an Edit or MultiEdit input; a Write or NotebookEdit is one pair with no old side. */
export function editPairs(name: string, input: unknown): [oldStr: string, newStr: string][] | undefined {
  const obj = asObj(input);
  switch (name) {
    case "Edit":
      return [[str(obj.old_string) ?? "", str(obj.new_string) ?? ""]];
    case "MultiEdit":
      return Array.isArray(obj.edits)
        ? obj.edits.map((e) => {
            const eo = asObj(e);
            return [str(eo.old_string) ?? "", str(eo.new_string) ?? ""];
          })
        : [];
    case "Write":
      return [["", str(obj.content) ?? ""]];
    case "NotebookEdit":
      return [["", str(obj.new_source) ?? ""]];
    default:
      return undefined;
  }
}

/** "+N −M" for an edit tool call, the same counts the Files tab adds up per hunk. */
export function editCounts(name: string, input: unknown): EditCounts | undefined {
  const pairs = editPairs(name, input);
  if (!pairs) return undefined;
  let added = 0;
  let removed = 0;
  for (const [o, n] of pairs) {
    added += countLines(n);
    removed += countLines(o);
  }
  return name === "Write" || name === "NotebookEdit" ? { added } : { added, removed };
}

function toLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The mini diff of an edit tool call: one removed/added block per pair, a Write capped to a preview. */
export function editLines(name: string, input: unknown): EditLines[] | undefined {
  const pairs = editPairs(name, input);
  if (!pairs) return undefined;
  return pairs.map(([o, n]) => {
    const added = toLines(n);
    if ((name === "Write" || name === "NotebookEdit") && added.length > WRITE_PREVIEW_LINES) {
      const rest = added.length - WRITE_PREVIEW_LINES;
      return { removed: [], added: [...added.slice(0, WRITE_PREVIEW_LINES), `… ${rest} more line${rest === 1 ? "" : "s"}`] };
    }
    return { removed: toLines(o), added };
  });
}
