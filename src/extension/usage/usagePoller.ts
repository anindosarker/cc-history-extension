import * as vscode from "vscode";
import { CredentialsCache } from "./credentials";
import { DEFAULT_DISPLAY_SETTINGS, type UsageDisplaySettings } from "./format";
import { PollEngine, type UsageFailure, type UsageState } from "./pollEngine";
import { intervalMs } from "./schedule";
import { fetchUsage } from "./usageClient";

export type { UsageFailure, UsageState };

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
    enabled: cfg.get<boolean>("enabled") ?? true,
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
 * Polls the usage endpoint on an interval. Pauses while the window is unfocused and refreshes as
 * soon as focus returns; the engine decides the delay after each attempt (see pollEngine).
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
        if (s.focused && !was) void this.refresh();
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
        if (this.settings.enabled) void this.refresh();
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
    if (this.settings.enabled) void this.refresh();
  }

  /** Poll now. Concurrent calls share the in-flight request. */
  refresh(): Promise<void> {
    if (!this.settings.enabled || this.disposed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    this.engine.state = { ...this.engine.state, refreshing: true };
    this.emit();
    this.inFlight = this.engine
      .pollOnce(this.settings.intervalMs)
      .then((outcome) => {
        this.nextDelayMs = outcome.delayMs;
      })
      .finally(() => {
        this.inFlight = undefined;
        this.emit();
        this.schedule();
      });
    return this.inFlight;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.settings.enabled || !this.focused) return;
    this.timer = setTimeout(() => void this.refresh(), this.nextDelayMs);
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
    for (const d of this.disposables) d.dispose();
    this.changeEmitter.dispose();
  }
}
