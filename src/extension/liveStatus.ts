import * as fs from "node:fs";
import * as path from "node:path";

export type LiveStatus = "running" | "open" | "ended";

export const RUNNING_WINDOW_MS = 2 * 60_000;
export const ENDED_WINDOW_MS = 10 * 60_000;

/**
 * running: a live Claude process owns the session and wrote to it in the last two minutes.
 * open: a live process owns it but it has been idle.
 * ended: no live process, but the log changed in the last ten minutes.
 */
export function computeStatus(input: { alive: boolean; mtime: number; now: number }): LiveStatus | undefined {
  const age = input.now - input.mtime;
  if (input.alive) return age <= RUNNING_WINDOW_MS ? "running" : "open";
  return age <= ENDED_WINDOW_MS ? "ended" : undefined;
}

export const STATUS_LABEL: Record<LiveStatus, string> = {
  running: "Running",
  open: "Open",
  ended: "Ended recently",
};

/** EPERM means the process exists but belongs to someone else, so treat it as alive. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Session ids that currently have a live Claude Code process, from ~/.claude/sessions/<pid>.json. */
export async function readLiveSessionIds(sessionsDir: string, alive: (pid: number) => boolean = isPidAlive): Promise<Set<string>> {
  const out = new Set<string>();
  let names: string[];
  try {
    names = await fs.promises.readdir(sessionsDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(path.join(sessionsDir, name), "utf8");
      const data = JSON.parse(raw) as { pid?: unknown; sessionId?: unknown };
      const pid = typeof data.pid === "number" ? data.pid : Number.parseInt(path.basename(name, ".json"), 10);
      if (typeof data.sessionId !== "string" || !Number.isFinite(pid)) continue;
      if (alive(pid)) out.add(data.sessionId);
    } catch {
      /* unreadable or malformed entry, skip */
    }
  }
  return out;
}
