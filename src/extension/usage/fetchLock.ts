import * as fs from "node:fs";
import * as path from "node:path";
import { pidAlive } from "./leader";
import { LOCK_MAX_AGE_MS } from "./schedule";
import { usageCacheDir } from "./sharedCache";

/**
 * An exclusive lock file around one usage fetch, shared by every VS Code window. It is created with
 * O_EXCL ("wx"), so of two windows only one gets it; only the holder fetches, writes usage.json and
 * deletes the lock.
 */
export interface LockInfo {
  /** Unique per acquisition, so a window never deletes a lock it no longer holds. */
  id: string;
  pid: number;
  at: number;
}

export const FETCH_LOCK_FILE = "fetch.lock";

export function fetchLockPath(home?: string): string {
  return path.join(usageCacheDir(home), FETCH_LOCK_FILE);
}

export interface LockDeps {
  /** Create the file exclusively; false when it already exists. */
  create(data: string): boolean;
  read(): string | undefined;
  /** Modification time of the lock file, for an empty one left by a crash between create and write. */
  mtime(): number | undefined;
  remove(): void;
  now(): number;
  pidAlive(pid: number): boolean;
  pid: number;
}

export function parseLock(raw: string | undefined): LockInfo | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<LockInfo>;
    return typeof v.id === "string" && typeof v.pid === "number" && typeof v.at === "number" ? { id: v.id, pid: v.pid, at: v.at } : undefined;
  } catch {
    return undefined;
  }
}

/** A lock is stale when unreadable, its holder process is gone, or it is older than LOCK_MAX_AGE_MS. */
export function lockStale(lock: LockInfo | undefined, now: number, alive: (pid: number) => boolean): boolean {
  if (!lock) return true;
  return now - lock.at >= LOCK_MAX_AGE_MS || !alive(lock.pid);
}

let seq = 0;

export class FetchLock {
  constructor(private readonly deps: LockDeps) {}

  /** The current holder, or undefined when nobody holds a live lock. */
  holder(): LockInfo | undefined {
    const lock = parseLock(this.deps.read());
    return lock && !lockStale(lock, this.deps.now(), (p) => this.deps.pidAlive(p)) ? lock : undefined;
  }

  /** Take the lock; a stale one is removed and the create retried once. Returns the lock, or undefined. */
  tryAcquire(): LockInfo | undefined {
    const { deps } = this;
    const info: LockInfo = { id: `${deps.pid}-${deps.now()}-${++seq}`, pid: deps.pid, at: deps.now() };
    const data = JSON.stringify(info);
    try {
      if (deps.create(data)) return info;
      const raw = deps.read();
      // An empty file is a holder between create and write, unless it has sat there for a while.
      const stale = raw === "" ? deps.now() - (deps.mtime() ?? 0) >= LOCK_MAX_AGE_MS : lockStale(parseLock(raw), deps.now(), (p) => deps.pidAlive(p));
      if (!stale) return undefined;
      deps.remove();
      return deps.create(data) ? info : undefined;
    } catch {
      return undefined;
    }
  }

  /** Delete the lock only while it is still ours. */
  release(lock: LockInfo): void {
    try {
      if (parseLock(this.deps.read())?.id === lock.id) this.deps.remove();
    } catch {
      // Already gone.
    }
  }
}

export function fileLockDeps(file = fetchLockPath()): LockDeps {
  return {
    create: (data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      let fd: number;
      try {
        fd = fs.openSync(file, "wx", 0o600);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw err;
      }
      try {
        fs.writeSync(fd, data);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    },
    read: () => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return undefined;
      }
    },
    mtime: () => {
      try {
        return fs.statSync(file).mtimeMs;
      } catch {
        return undefined;
      }
    },
    remove: () => fs.rmSync(file, { force: true }),
    now: () => Date.now(),
    pidAlive,
    pid: process.pid,
  };
}
