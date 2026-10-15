import type { TitleSource } from "./types";

export interface TitleInputs {
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  /** Slash command that opened the session, like "/review", used when no real prompt exists. */
  firstCommand?: string;
  startedAt?: number;
  sessionId: string;
}

const MAX_PROMPT_TITLE = 80;

/** custom-title, then ai-title, then first prompt, then first slash command, then start date, then id. */
export function resolveTitle(inputs: TitleInputs): { title: string; source: TitleSource } {
  const custom = clean(inputs.customTitle);
  if (custom) return { title: custom, source: "custom" };
  const ai = clean(inputs.aiTitle);
  if (ai) return { title: ai, source: "ai" };
  const prompt = clean(inputs.firstPrompt);
  if (prompt) {
    const oneLine = prompt.replace(/\s+/g, " ");
    const title =
      oneLine.length > MAX_PROMPT_TITLE
        ? oneLine.slice(0, MAX_PROMPT_TITLE - 1).trimEnd() + "…"
        : oneLine;
    return { title, source: "prompt" };
  }
  const command = clean(inputs.firstCommand);
  if (command) return { title: command, source: "command" };
  if (inputs.startedAt) return { title: `Session ${formatStart(inputs.startedAt)}`, source: "date" };
  return { title: inputs.sessionId, source: "id" };
}

function formatStart(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clean(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}
