import * as vscode from "vscode";
import { CredentialsCache } from "./credentials";
import { DEFAULT_DISPLAY_SETTINGS, type UsageDisplaySettings } from "./format";
import { PollEngine, type UsageFailure, type UsageState } from "./pollEngine";
import { intervalMs, manualWaitUntil, usageDisabledByEnv } from "./schedule";
import {
  cacheDecision,
  readUsageCache,
  updateUsageCache,
  usageCachePath,
  watchUsageCache,
  type UsageCacheFile,
} from "./sharedCache";
import { fetchUsage } from "./usageClient";

export type { UsageFailure, UsageState };
export { usageDisabledByEnv };

export interface UsageSettings extends UsageDisplaySettings {
  enabled: boolean;
  intervalMs: number;
  showInStatusBar: boolean;
}

export type RefreshSource = "auto" | "manual";

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
 * Polls the usage endpoint on an interval, once per machine: every window shares a cache file and
 * only fetches when nobody fetched within the interval. Pauses while the window is unfocused and
 * looks again when focus returns; the engine decides the delay after each attempt (see pollEngine).
 * Manual refreshes are limited to one per minute and 429s back off hard (see schedule).
 */
export class UsagePoller implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<UsageState>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private settings = readUsageSettings();
  private focused = vscode.window.state.focused;
  private disposed = false;
  // Token lives here only; re-read near expiry or after the server rejects it.
  private readonly credentials = new CredentialsCache();
  private readonly engine: PollEngine;
  private nextDelayMs = this.settings.intervalMs;
  private lastManualAt: number | undefined;
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
    this.disposables.push(
      vscode.window.onDidChangeWindowState((s) => {
        const was = this.focused;
        this.focused = s.focused;
        if (s.focused && !was) void this.refresh("auto");
        if (!s.focused) this.clearTimer();
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
        this.engine.reset();
        if (this.settings.enabled) void this.refresh("auto");
        else {
          this.clearTimer();
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

  start(): void {
    if (!this.settings.enabled) return;
    this.stopWatching = watchUsageCache(() => void this.onCacheChanged(), this.cacheFile);
    void this.refresh("auto");
  }

  /** Another window wrote the cache: take its snapshot or backoff without fetching. */
  private async onCacheChanged(): Promise<void> {
    if (this.disposed || !this.settings.enabled || this.inFlight) return;
    const cache = await readUsageCache(this.cacheFile);
    if (!cache || !this.engine.adopt(cache)) return;
    this.emit();
    const now = Date.now();
    const d = cacheDecision({ cache, now, intervalMs: this.settings.intervalMs, manual: false });
    if (d.action !== "fetch") {
      this.nextDelayMs = Math.max(0, d.until - now);
      this.schedule();
    }
  }

  /**
   * Poll now, unless something says not to: the manual gap, another window's fresh snapshot, a 429
   * backoff, another window's fetch in progress, or the pause. Concurrent calls share the in-flight run.
   */
  refresh(source: RefreshSource = "auto"): Promise<void> {
    if (!this.settings.enabled || this.disposed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const now = Date.now();
    if (source === "manual") {
      const until = manualWaitUntil(this.lastManualAt, now);
      if (until !== undefined) {
        this.engine.state = { ...this.engine.state, manualWaitUntil: until };
        this.emit();
        return Promise.resolve();
      }
      this.lastManualAt = now;
      this.engine.resume();
    } else if (this.engine.state.paused) {
      return Promise.resolve();
    }
    this.clearTimer();
    this.inFlight = this.run(source).finally(() => {
      this.inFlight = undefined;
      this.emit();
      this.schedule();
    });
    return this.inFlight;
  }

  private async run(source: RefreshSource): Promise<void> {
    const now = Date.now();
    const { manualWaitUntil: _w, ...rest } = this.engine.state;
    this.engine.state = rest;
    const cache = await readUsageCache(this.cacheFile);
    if (cache) this.engine.adopt(cache);
    const d = cacheDecision({
      cache,
      now,
      intervalMs: this.settings.intervalMs,
      manual: source === "manual",
      localFetchedAt: this.engine.state.snapshot?.fetchedAt,
    });
    if (d.action !== "fetch") {
      this.nextDelayMs = Math.max(0, d.until - now);
      if (d.action === "wait") {
        this.engine.state = { ...this.engine.state, nextAllowedAt: d.until };
        if (source === "manual") this.engine.state = { ...this.engine.state, manualWaitUntil: d.until };
      }
      this.log(`${new Date(now).toISOString()} ${describeDecision(d, now)}`);
      return;
    }
    this.engine.state = { ...this.engine.state, refreshing: true };
    this.emit();
    await this.writeCache((c) => ({ ...c, fetchingSince: now }));
    const outcome = await this.engine.pollOnce(this.settings.intervalMs);
    this.nextDelayMs = outcome.delayMs;
    await this.writeCache((c) => {
      const { fetchingSince: _f, ...keep } = c;
      if (outcome.state.snapshot && !outcome.state.error) {
        const { nextAllowedAt: _n, lastError: _e, ...fresh } = keep;
        return { ...fresh, fetchedAt: outcome.state.snapshot.fetchedAt, snapshot: outcome.state.snapshot, plan: outcome.state.plan };
      }
      const next: UsageCacheFile = { ...keep };
      if (outcome.state.error) {
        const { reason, message, status, at } = outcome.state.error;
        next.lastError = { reason, message, ...(status !== undefined ? { status } : {}), at };
      }
      if (outcome.rateLimited) next.nextAllowedAt = outcome.rateLimited.nextAllowedAt;
      return next;
    });
  }

  private async writeCache(change: (c: UsageCacheFile) => UsageCacheFile): Promise<void> {
    try {
      await updateUsageCache(change, this.cacheFile);
    } catch (err) {
      this.log(`could not write ${this.cacheFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.settings.enabled || !this.focused || this.engine.state.paused) return;
    this.timer = setTimeout(() => void this.refresh("auto"), this.nextDelayMs);
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
    this.stopWatching?.();
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }
}

function describeDecision(d: Exclude<ReturnType<typeof cacheDecision>, { action: "fetch" }>, now: number): string {
  const inS = `${Math.round((d.until - now) / 1000)}s`;
  switch (d.action) {
    case "use-cache":
      return `using the usage snapshot another window fetched, next poll in ${inS}`;
    case "wait":
      return `429 backoff in force, no fetch for ${inS}`;
    case "skip-locked":
      return `another window is fetching usage, looking again in ${inS}`;
  }
}
