import type { OpenAt } from "./openAt";
import type { ThemeTokenColors } from "./themeTokens";
import type { FileChange, SessionMeta, SubagentInfo, Turn, WorkflowRun } from "./types";

/** Messages the webview sends to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "loadSession" }
  /** Re-read the whole transcript; the viewer keeps its scroll position, search and folds. */
  | { type: "reloadSession" }
  | { type: "openDiff"; path: string; hunkIndex?: number }
  /** Open a file in an editor; relative paths resolve against the session cwd, line and column are 1-based. */
  | { type: "revealFile"; path: string; line?: number; column?: number }
  | { type: "revealJsonl" }
  | { type: "export"; mode: "file" | "clipboard"; agentId?: string }
  /** Write the reference transcript and copy a prompt that points a new agent at it. */
  | { type: "copyAgentPrompt" }
  | { type: "listAgents" }
  | { type: "loadAgent"; agentId: string }
  /** Ask for file changes across the main transcript and every subagent and workflow agent transcript. */
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
      /** A re-parse of a session already shown: the viewer swaps the turns in place. */
      reload?: boolean;
    }
  /**
   * Turns appended to (or changed at the tail of) a running session. The viewer replaces
   * everything from `offset` on. Files are the main transcript's own edits.
   */
  | { type: "sessionAppend"; offset: number; turns: Turn[]; meta: SessionMeta; files?: FileChange[] }
  | { type: "agentAppend"; agentId: string; offset: number; turns: Turn[]; tokens: number }
  /** Whether a live Claude process owns the session and wrote to it in the last two minutes. */
  | { type: "live"; live: boolean }
  | { type: "openAt"; value: OpenAt }
  | { type: "sessionTurns"; turns: Turn[]; offset: number; done: boolean }
  | { type: "error"; message: string }
  /** Direct subagents in `list`; workflow runs carry their own agents, never repeated in `list`. */
  | { type: "agents"; list: SubagentInfo[]; workflows: WorkflowRun[] }
  | { type: "agentStart"; agentId: string; totalTurns: number; tokens: number }
  | { type: "agentTurns"; agentId: string; turns: Turn[]; offset: number; done: boolean }
  | { type: "agentError"; agentId: string; message: string }
  /** Merged file changes, main plus subagents and workflow agents. */
  | { type: "files"; files: FileChange[] }
  /** Syntax colors of the active VS Code theme; an empty map means the webview's fallback palette. */
  | { type: "themeTokens"; colors: ThemeTokenColors };
