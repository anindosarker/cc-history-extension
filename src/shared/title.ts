import type { TitleSource } from "./types";

export interface TitleInputs {
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  sessionId: string;
}

const MAX_PROMPT_TITLE = 80;

/** custom-title beats ai-title beats first user prompt beats the session id. */
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
  return { title: inputs.sessionId, source: "id" };
}

function clean(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}
