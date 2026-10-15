import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageErrorReason } from "../../shared/usage";
import { LOCK_MAX_AGE_MS, MANUAL_MIN_GAP_MS } from "./schedule";
import type { UsageSnapshot } from "./usageClient";

/**
 * One usage fetch per machine: every VS Code window reads and writes this file so only one of them
 * talks to the endpoint per interval. It never holds a token, only the reply and the timing.
 */
export interface UsageCacheFile {
  /** When the snapshot was fetched. */
  fetchedAt?: number;
  snapshot?: UsageSnapshot;
  /** Plan and tier, from the credentials file (not a secret). */
  plan?: string;
  lastError?: { reason: UsageErrorReason; message: string; status?: number; at: number };
  /** No window may fetch before this (429 backoff). */
  nextAllowedAt?: number;
  /** A window started a fetch at this time; others skip while it is younger than LOCK_MAX_AGE_MS. */
  fetchingSince?: number;
}

export const USAGE_CACHE_FILE = "usage.json";

export function usageCacheDir(home = os.homedir()): string {
  return path.join(home, ".cache", "cc-history");
}

export function usageCachePath(home = os.homedir()): string {
  return path.join(usageCacheDir(home), USAGE_CACHE_FILE);
}

export type CacheAction =
  /** Nothing fresh enough and nothing in the way: fetch. */
  | { action: "fetch" }
  /** Another window fetched recently: adopt its snapshot, poll again at `until`. */
  | { action: "use-cache"; until: number }
  /** A 429 backoff is in force (ours or another window's): wait until `until`. */
  | { action: "wait"; until: number }
  /** Another window is fetching right now: look again at `until` (the watcher usually gets there first). */
  | { action: "skip-locked"; until: number };

export interface CacheDecisionInput {
  cache: UsageCacheFile | undefined;
  now: number;
  intervalMs: number;
  /** A manual refresh accepts a cached snapshot only when it is younger than the manual gap. */
  manual: boolean;
  /** When this window's own latest snapshot was fetched, in case the cache is older or missing. */
  localFetchedAt?: number;
}

export function cacheDecision(input: CacheDecisionInput): CacheAction {
  const { cache, now, intervalMs, manual } = input;
  if (cache?.fetchingSince !== undefined && now - cache.fetchingSince < LOCK_MAX_AGE_MS && cache.fetchingSince <= now) {
    return { action: "skip-locked", until: cache.fetchingSince + LOCK_MAX_AGE_MS };
  }
  if (cache?.nextAllowedAt !== undefined && cache.nextAllowedAt > now) return { action: "wait", until: cache.nextAllowedAt };
  const fetchedAt = Math.max(cache?.fetchedAt ?? 0, input.localFetchedAt ?? 0);
  if (fetchedAt > 0 && fetchedAt <= now) {
    const freshFor = manual ? Math.min(MANUAL_MIN_GAP_MS, intervalMs) : intervalMs;
    if (now - fetchedAt < freshFor) return { action: "use-cache", until: fetchedAt + intervalMs };
  }
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

/** Read, change, write; the change sees the latest contents so windows do not clobber each other's fields. */
export async function updateUsageCache(
  change: (cur: UsageCacheFile) => UsageCacheFile,
  file = usageCachePath(),
): Promise<UsageCacheFile> {
  const next = change((await readUsageCache(file)) ?? {});
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
