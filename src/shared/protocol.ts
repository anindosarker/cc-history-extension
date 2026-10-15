import type { OpenAt } from "./openAt";
import type { FileChange, SessionMeta, SubagentInfo, Turn } from "./types";

/** Messages the webview sends to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "loadSession" }
  | { type: "openDiff"; path: string; hunkIndex?: number }
  /** Open a file in an editor; relative paths resolve against the session cwd, line and column are 1-based. */
  | { type: "revealFile"; path: string; line?: number; column?: number }
  | { type: "revealJsonl" }
  | { type: "export"; mode: "file" | "clipboard"; agentId?: string }
  | { type: "listAgents" }
  | { type: "loadAgent"; agentId: string }
  /** Ask for file changes across the main transcript and every subagent transcript. */
  | { type: "loadFiles" }
  | { type: "resume" }
  /** Open the usage panel (runs the ccHistory.openUsage command). */
  | { type: "openUsage" }
  /** Reveal the session's working directory in the OS file manager. */
  | { type: "openFolder" }
  /** Other actions on the session's working directory. */
  | { type: "folderAction"; action: "newWindow" | "addToWorkspace" }
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
  | { type: "error"; message: string }
  | { type: "agents"; list: SubagentInfo[] }
  | { type: "agentStart"; agentId: string; totalTurns: number; tokens: number }
  | { type: "agentTurns"; agentId: string; turns: Turn[]; offset: number; done: boolean }
  | { type: "agentError"; agentId: string; message: string }
  /** Merged file changes, main plus subagents. */
  | { type: "files"; files: FileChange[] };
