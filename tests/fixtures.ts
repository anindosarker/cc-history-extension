/** Small synthetic jsonl builders. No real user data. */
export function line(obj: unknown): string {
  return JSON.stringify(obj);
}

let counter = 0;
const uuid = () => `uuid-${++counter}`;

export function userMsg(content: unknown, extra: Record<string, unknown> = {}): string {
  return line({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content },
    uuid: uuid(),
    timestamp: "2026-01-02T10:00:00.000Z",
    cwd: "/home/me/proj",
    sessionId: "sess-1",
    version: "1.0.0",
    gitBranch: "main",
    ...extra,
  });
}

export function assistantMsg(
  content: unknown[],
  extra: Record<string, unknown> = {},
  msgId = `msg-${++counter}`,
): string {
  return line({
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    message: { id: msgId, role: "assistant", model: "claude", content, usage: {} },
    uuid: uuid(),
    timestamp: "2026-01-02T10:01:00.000Z",
    cwd: "/home/me/proj",
    sessionId: "sess-1",
    version: "1.0.0",
    ...extra,
  });
}

export function toolUse(id: string, name: string, input: unknown) {
  return { type: "tool_use", id, name, input };
}

export function toolResult(id: string, content: unknown, isError = false): string {
  return userMsg([{ type: "tool_result", tool_use_id: id, content, is_error: isError }]);
}

export function readResult(id: string, text: string): string {
  const numbered = text
    .split("\n")
    .map((l, i) => `${String(i + 1).padStart(6, " ")}\t${l}`)
    .join("\n");
  return toolResult(id, numbered);
}
