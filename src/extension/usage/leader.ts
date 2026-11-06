import * as fs from "node:fs";
import * as path from "node:path";
import { usageCacheDir } from "./sharedCache";

/**
 * Every VS Code window runs its own extension host, so without coordination each would run its own
 * poll timer. A lease file names the one window (by process id) that runs the background poll; the
 * others render what it writes to usage.json and take over only when it is gone.
 */
export interface LeaseFile {
  pid: number;
  heartbeatAt: number;
}

export const LEADER_FILE = "leader.json";
/** How often the leader renews the lease and followers look for a dead one. */
export const HEARTBEAT_MS = 60_000;
/** A lease not renewed for this long is free even when its process id is still in use. */
export const LEASE_STALE_MS = 5 * 60_000;

export function leaderPath(home?: string): string {
  return path.join(usageCacheDir(home), LEADER_FILE);
}

export interface LeaseDeps {
  /** Raw lease file contents, or undefined when missing. */
  read(): string | undefined;
  /** Replace the lease file atomically. */
  write(data: string): void;
  remove(): void;
  now(): number;
  pidAlive(pid: number): boolean;
  /** This window's process id. */
  pid: number;
}

export function parseLease(raw: string | undefined): LeaseFile | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<LeaseFile>;
    return typeof v.pid === "number" && typeof v.heartbeatAt === "number" ? { pid: v.pid, heartbeatAt: v.heartbeatAt } : undefined;
  } catch {
    return undefined;
  }
}

/** Free when missing, unreadable, held by a dead process, or not renewed within LEASE_STALE_MS. */
export function leaseFree(lease: LeaseFile | undefined, now: number, pidAlive: (pid: number) => boolean, staleMs = LEASE_STALE_MS): boolean {
  if (!lease) return true;
  if (now - lease.heartbeatAt >= staleMs) return true;
  return !pidAlive(lease.pid);
}

export class LeaderLease {
  private leader = false;

  constructor(
    private readonly deps: LeaseDeps,
    private readonly staleMs = LEASE_STALE_MS,
  ) {}

  get isLeader(): boolean {
    return this.leader;
  }

  /**
   * Renew the lease when this window holds it, take it when it is free, otherwise follow. After
   * taking it, read it back: of two windows racing, the last writer wins and the other follows.
   * Returns whether this window leads now.
   */
  tick(): boolean {
    const { deps } = this;
    try {
      const cur = parseLease(deps.read());
      if (cur?.pid !== deps.pid && !leaseFree(cur, deps.now(), (p) => deps.pidAlive(p), this.staleMs)) {
        this.leader = false;
        return false;
      }
      deps.write(JSON.stringify({ pid: deps.pid, heartbeatAt: deps.now() } satisfies LeaseFile));
      this.leader = parseLease(deps.read())?.pid === deps.pid;
    } catch {
      this.leader = false;
    }
    return this.leader;
  }

  /** Give the lease up, deleting the file only while it still names this window. */
  release(): void {
    try {
      if (parseLease(this.deps.read())?.pid === this.deps.pid) this.deps.remove();
    } catch {
      // Nothing to release.
    }
    this.leader = false;
  }
}

/** A process exists when signal 0 can be sent to it; EPERM means it exists under another user. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lease on disk, next to usage.json; synchronous so release works during shutdown. */
export function fileLeaseDeps(file = leaderPath()): LeaseDeps {
  return {
    read: () => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return undefined;
      }
    },
    write: (data) => {
      const dir = path.dirname(file);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = path.join(dir, `.${LEADER_FILE}.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, data, { encoding: "utf8", mode: 0o600 });
      try {
        fs.renameSync(tmp, file);
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
    },
    remove: () => fs.rmSync(file, { force: true }),
    now: () => Date.now(),
    pidAlive,
    pid: process.pid,
  };
}
