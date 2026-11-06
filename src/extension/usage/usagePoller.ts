import * as vscode from "vscode";
import { CredentialsCache } from "./credentials";
import { DEFAULT_DISPLAY_SETTINGS, type UsageDisplaySettings } from "./format";
import { PollEngine, type UsageFailure, type UsageState } from "./pollEngine";
import { fileLeaseDeps, HEARTBEAT_MS, LeaderLease } from "./leader";
import { nextPollDelay, UsageRefresher, type RefreshSource } from "./refresher";
import { intervalMs, usageDisabledByEnv } from "./schedule";
import { FetchLock, fileLockDeps } from "./fetchLock";
import { cacheDecision, readUsageCache, updateUsageCache, usageCachePath, waitForLockRelease, watchUsageCache } from "./sharedCache";
import { fetchUsage } from "./usageClient";

export type { RefreshSource, UsageFailure, UsageState };
export { usageDisabledByEnv };

export interface UsageSettings extends UsageDisplaySettings {
  enabled: boolean;
  intervalMs: number;
  showInStatusBar: boolean;
}

function clampPct(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(1, v));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function readUsageSettings(): UsageSettings {
  const cfg = vscode.workspace.getConfiguration("ccHistory.usage");
  const d = DEFAULT_DISPLAY_SETTINGS;
  let warnAt = clampPct(cfg.get("warnAt"), d.warnAt);
  let errorAt = clampPct(cfg.get("errorAt"), d.errorAt);
  // Warning must come first on the way up; a reversed pair is treated as a slip, not a request.
  if (warnAt > errorAt) [warnAt, errorAt] = [errorAt, warnAt];
  return {
    enabled: !usageDisabledByEnv() && (cfg.get<boolean>("enabled") ?? true),
    intervalMs: intervalMs(cfg.get<number>("intervalSeconds")),
    showInStatusBar: cfg.get<boolean>("showInStatusBar") ?? true,
    warnAt,
    errorAt,
    colorMode: oneOf(cfg.get("colorMode"), ["background", "text", "off"], d.colorMode),
    colorBy: oneOf(cfg.get("colorBy"), ["max", "fiveHour"], d.colorBy),
    format: oneOf(cfg.get("format"), ["full", "compact", "max"], d.format),
    pulse: cfg.get<boolean>("pulse") ?? d.pulse,
  };
}

/**
 * Polls the usage endpoint once per machine. One window holds the leader lease (leader.ts) and runs
 * the background poll; the others run no poll timer and render what it writes to usage.json. Any
 * window refreshes on focus or panel open when the numbers are five minutes old, and on a manual
 * click right away, through the shared fetch lock. Only a server Retry-After holds a click back.
 */
export class UsagePoller implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<UsageState>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly lease = new LeaderLease(fileLeaseDeps());
  private settings = readUsageSettings();
  private disposed = false;
  // Token lives here only; re-read near expiry or after the server rejects it.
  private readonly credentials = new CredentialsCache();
  private readonly engine: PollEngine;
  private readonly refresher: UsageRefresher;
  private readonly cacheFile = usageCachePath();
  private stopWatching: (() => void) | undefined;

  constructor(
    version: string,
    private readonly log: (line: string) => void = () => {},
  ) {
    this.engine = new PollEngine({
      readCredentials: (now, opts) => this.credentials.get(now, opts),
      invalidateCredentials: () => this.credentials.invalidate(),
      fetchUsage: (token) => fetchUsage(token, { version }),
      now: () => Date.now(),
      log: (line) => this.log(line),
    });
    const lock = new FetchLock(fileLockDeps());
    this.refresher = new UsageRefresher({
      engine: this.engine,
      lock,
      waitForRelease: (id, deadline) => waitForLockRelease(id, deadline, () => lock.holder()?.id, { cancelled: () => this.disposed }),
      cancelled: () => this.disposed,
      invalidateCredentials: () => this.credentials.invalidate(),
      readCache: () => readUsageCache(this.cacheFile),
      updateCache: async (change) => {
        try {
          await updateUsageCache(change, this.cacheFile);
        } catch (err) {
          this.log(`could not write ${this.cacheFile}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
      now: () => Date.now(),
      intervalMs: () => this.settings.intervalMs,
      log: (line) => this.log(line),
      onChange: () => this.emit(),
    });
    this.disposables.push(
      vscode.window.onDidChangeWindowState((s) => {
        if (!s.focused || !this.settings.enabled) return;
        this.leaseTick();
        void this.refresh("focus");
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("ccHistory.usage")) return;
        const prev = this.settings;
        this.settings = readUsageSettings();
        // Display-only changes (colour, format, thresholds) just need a re-render, not a poll.
        if (prev.enabled === this.settings.enabled && prev.intervalMs === this.settings.intervalMs) {
          this.emit();
          return;
        }
        if (this.settings.enabled) {
          this.startWatching();
          this.startHeartbeat();
          void this.refresh("auto");
        } else {
          this.clearTimer();
          this.stopHeartbeat();
          this.stopWatching?.();
          this.stopWatching = undefined;
          this.lease.release();
          this.emit();
        }
      }),
    );
  }

  get currentSettings(): UsageSettings {
    return this.settings;
  }

  get state(): UsageState {
    return this.engine.state;
  }

  /** True while this window holds the leader lease and runs the background poll. */
  get isLeader(): boolean {
    return this.lease.isLeader;
  }

  start(): void {
    if (!this.settings.enabled) return;
    this.startWatching();
    this.startHeartbeat();
    // Leader or not, show what is already in usage.json and fetch when it is old.
    void this.refresh(this.lease.isLeader ? "auto" : "focus");
  }

  private startWatching(): void {
    if (this.stopWatching) return;
    this.stopWatching = watchUsageCache(() => void this.onCacheChanged(), this.cacheFile);
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.leaseTick();
    this.heartbeat = setInterval(() => this.leaseTick(), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** Renew or take the lease; start the poll timer on becoming leader, stop it on losing the lease. */
  private leaseTick(): void {
    if (this.disposed || !this.settings.enabled) return;
    const was = this.lease.isLeader;
    const now = this.lease.tick();
    if (now === was) return;
    this.log(`${new Date().toISOString()} ${now ? "this window now runs the usage poll" : "another window runs the usage poll"} (pid ${process.pid})`);
    if (now) void this.refresh("auto");
    else this.clearTimer();
  }

  /** Another window wrote the cache: take its snapshot, error or Retry-After and re-time the next poll. */
  private async onCacheChanged(): Promise<void> {
    if (this.disposed || !this.settings.enabled || this.refresher.busy) return;
    const cache = await readUsageCache(this.cacheFile);
    if (!cache) return;
    if (this.refresher.observe(cache)) this.emit();
    const now = Date.now();
    const d = cacheDecision({ cache, now, minAgeMs: this.settings.intervalMs });
    if (d.action !== "fetch") {
      this.refresher.nextDelayMs = Math.max(0, d.until - now);
      this.schedule();
    }
  }

  /**
   * The signed-in account may have changed (after `claude auth login`): drop the cached token and
   * fetch now instead of trusting the old account's snapshot or Retry-After.
   */
  credentialsChanged(): void {
    if (this.disposed) return;
    // Every window sees the switch through usage.json; a fetch in flight here discards its result.
    void this.refresher
      .switchAccount()
      .then(() => this.refresher.settled())
      .then(() => {
        this.refresher.force();
        return this.refresh("manual");
      });
  }

  /** See RefreshSource. Concurrent calls share the run in flight. */
  refresh(source: RefreshSource = "auto"): Promise<void> {
    if (!this.settings.enabled || this.disposed) return Promise.resolve();
    this.clearTimer();
    const p = this.refresher.refresh(source);
    void p.finally(() => this.schedule());
    return p;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.settings.enabled || this.refresher.busy) return;
    // Followers run no poll timer; the leader's writes reach them through the cache watcher.
    const delay = nextPollDelay(this.engine.state, this.refresher.nextDelayMs, this.lease.isLeader, Date.now());
    if (delay !== undefined) this.timer = setTimeout(() => void this.refresh("auto"), delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private emit(): void {
    if (!this.disposed) this.changeEmitter.fire(this.state);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.stopHeartbeat();
    this.lease.release();
    this.stopWatching?.();
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }
}
