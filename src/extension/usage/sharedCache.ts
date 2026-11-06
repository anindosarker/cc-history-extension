import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageAccount, UsageErrorReason } from "../../shared/usage";
import { FOCUS_STALE_MS, LOCK_POLL_MS, RESET_GRACE_MS } from "./schedule";
import type { UsageSnapshot } from "./usageClient";

/**
 * One usage fetch per machine: every VS Code window reads and writes this file so only one of them
 * talks to the endpoint at a time. It never holds a token, only the reply, the account label and the timing.
 */
export interface UsageCacheFile {
  /** When the snapshot was fetched. */
  fetchedAt?: number;
  snapshot?: UsageSnapshot;
  /** Plan and tier, from the credentials file (not a secret). */
  plan?: string;
  /** Signed-in email and organization, from ~/.claude.json. */
  account?: UsageAccount;
  /** The latest failed attempt; cleared by the next success. */
  lastError?: { reason: UsageErrorReason; message: string; status?: number; at: number };
  /** When any window last finished an attempt, good or bad; background polls space themselves from it. */
  attemptedAt?: number;
  /** The server's Retry-After from a 429: no window fetches before this, manual refreshes included. */
  retryUntil?: number;
  /**
   * Bumped when any window switches account. Every window that sees a newer value drops its cached
   * token and the old account's numbers; a fetch started before it never writes its result.
   */
  credentialsEpoch?: number;
}

export const USAGE_CACHE_FILE = "usage.json";

export function usageCacheDir(home = os.homedir()): string {
  return path.join(home, ".cache", "cc-history");
}

export function usageCachePath(home = os.homedir()): string {
  return path.join(usageCacheDir(home), USAGE_CACHE_FILE);
}

export type CacheAction =
  /** Nothing in the way: fetch (after taking the fetch lock). */
  | { action: "fetch" }
  /** The latest attempt is recent enough for this kind of refresh: look again at `until`. */
  | { action: "fresh"; until: number }
  /** Rate limited (server Retry-After, at least a minute after any 429): no fetch before `until`. */
  | { action: "retry-after"; until: number };

export interface CacheDecisionInput {
  cache: UsageCacheFile | undefined;
  now: number;
  /**
   * Skip the fetch while the latest attempt (this window's or another's) is younger than this:
   * the poll interval for timer polls, five minutes for focus and panel open, 0 for manual.
   */
  minAgeMs: number;
  /** When this window last fetched or attempted, in case the cache file is older or missing. */
  localAttemptedAt?: number;
  /** After an account switch: the old account's rate limit does not apply. */
  ignoreRetryAfter?: boolean;
}

/** True once any limit in the snapshot has passed its reset time: its numbers are no longer right. */
export function resetPassed(snapshot: UsageSnapshot | undefined, now: number): boolean {
  if (!snapshot) return false;
  const limits = [snapshot.fiveHour, snapshot.weekly, ...snapshot.scoped];
  return limits.some((l) => l?.resetsAt !== undefined && l.resetsAt + RESET_GRACE_MS <= now);
}

export function cacheDecision(input: CacheDecisionInput): CacheAction {
  const { cache, now } = input;
  if (!input.ignoreRetryAfter && cache?.retryUntil !== undefined && cache.retryUntil > now) {
    return { action: "retry-after", until: cache.retryUntil };
  }
  if (input.minAgeMs <= 0) return { action: "fetch" };
  const last = Math.max(cache?.attemptedAt ?? 0, cache?.fetchedAt ?? 0, input.localAttemptedAt ?? 0);
  // A window that has reset makes the numbers wrong, so wait no longer than the focus gate for new ones.
  const minAge = resetPassed(cache?.snapshot, now) ? Math.min(input.minAgeMs, FOCUS_STALE_MS) : input.minAgeMs;
  if (last > 0 && last <= now && now - last < minAge) return { action: "fresh", until: last + minAge };
  return { action: "fetch" };
}

export async function readUsageCache(file = usageCachePath()): Promise<UsageCacheFile | undefined> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null ? (v as UsageCacheFile) : undefined;
  } catch {
    return undefined;
  }
}

/** Create the folder (0700) and write atomically: a temp file next to it, then rename; the file is 0600. */
export async function writeUsageCache(data: UsageCacheFile, file = usageCachePath()): Promise<void> {
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${USAGE_CACHE_FILE}.${process.pid}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  try {
    await fs.promises.rename(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Read, change, write; the change sees the latest contents. Result writes happen under the fetch lock;
 * whatever else writes, an account switch's epoch and a rate limit never go backwards.
 */
export async function updateUsageCache(
  change: (cur: UsageCacheFile) => UsageCacheFile,
  file = usageCachePath(),
): Promise<UsageCacheFile> {
  const cur = (await readUsageCache(file)) ?? {};
  const next = change(cur);
  const epoch = Math.max(cur.credentialsEpoch ?? 0, next.credentialsEpoch ?? 0);
  if (epoch > 0) next.credentialsEpoch = epoch;
  await writeUsageCache(next, file);
  return next;
}

/** Watch the cache folder for writes of the file (the file itself may not exist yet); debounced. */
export function watchUsageCache(onChange: () => void, file = usageCachePath(), debounceMs = 500): () => void {
  const dir = path.dirname(file);
  const name = path.basename(file);
  let watcher: fs.FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    watcher = fs.watch(dir, (_event, changed) => {
      if (changed && String(changed) !== name) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    watcher.on("error", () => watcher?.close());
  } catch {
    watcher = undefined;
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

/**
 * Wait until the fetch lock `id` is released (true), `deadline` passes or `cancelled` turns true
 * (false). `holderId` reads the current holder's id.
 */
export async function waitForLockRelease(
  id: string,
  deadline: number,
  holderId: () => string | undefined,
  opts: { pollMs?: number; now?: () => number; cancelled?: () => boolean } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? LOCK_POLL_MS;
  for (;;) {
    if (opts.cancelled?.()) return false;
    if (holderId() !== id) return true;
    if (now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - now()))));
  }
}
