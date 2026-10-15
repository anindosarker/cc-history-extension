import type { OpenAt } from "./openAt";
import type { FileChange, SessionMeta, Turn } from "./types";

/** Messages the webview sends to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "loadSession" }
  | { type: "openDiff"; path: string; hunkIndex?: number }
  | { type: "revealFile"; path: string }
  | { type: "revealJsonl" }
  | { type: "export"; mode: "file" | "clipboard" }
  | { type: "resume" }
  | { type: "setOpenAt"; value: OpenAt }
  | { type: "copyText"; text: string };

/** Messages the extension host sends to the webview. */
export type HostToWebview =
  | { type: "loading" }
  | {
      type: "sessionStart";
      meta: SessionMeta;
      files: FileChange[];
      totalTurns: number;
      openAt: OpenAt;
    }
  | { type: "openAt"; value: OpenAt }
  | { type: "sessionTurns"; turns: Turn[]; offset: number; done: boolean }
  | { type: "error"; message: string };
