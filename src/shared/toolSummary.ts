/** One-line description of a tool call, used for chips and text export. */
export function summarizeToolUse(name: string, input: unknown): string {
  const obj = isRecord(input) ? input : {};
  const str = (k: string): string | undefined => {
    const v = obj[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  switch (name) {
    case "Bash":
      return clip(str("description") ?? firstLine(str("command") ?? ""), 80);
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "Read":
      return str("file_path") ?? "";
    case "NotebookEdit":
      return str("notebook_path") ?? "";
    case "Grep":
    case "Glob":
      return clip(str("pattern") ?? "", 80);
    case "WebFetch":
      return clip(str("url") ?? "", 80);
    case "WebSearch":
      return clip(str("query") ?? "", 80);
    case "Agent":
    case "Task":
      return clip(str("description") ?? str("prompt") ?? "", 80);
    case "Skill":
      return str("skill") ?? "";
    default: {
      for (const v of Object.values(obj)) {
        if (typeof v === "string" && v.length > 0) return clip(firstLine(v), 80);
      }
      const first = Object.values(obj)[0];
      return first === undefined ? "" : clip(JSON.stringify(first), 80);
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return i === -1 ? s : s.slice(0, i);
}

export function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * Short display form of a tool name. MCP tools arrive as "mcp__<server>__<tool>" (the server part may
 * itself be "plugin_<name>_<name>"); only the tool part is shown, the full name goes in the title.
 */
export function displayToolName(name: string): string {
  if (!name.startsWith("mcp__")) return name;
  const parts = name.split("__").filter((p) => p.length > 0);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}
