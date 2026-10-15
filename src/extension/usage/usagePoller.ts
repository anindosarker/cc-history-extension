import * as vscode from "vscode";
import { CredentialsCache } from "./credentials";
import { DEFAULT_DISPLAY_SETTINGS, type UsageDisplaySettings } from "./format";
import { intervalMs, nextDelayMs } from "./schedule";
import { fetchUsage, UsageError, type UsageErrorReason, type UsageSnapshot } from "./usageClient";

export interface UsageFailure {
  reason: UsageErrorReason;
  message: string;
  at: number;
}

export interface UsageState {
  /** Last successful snapshot, kept while errors come and go. */
  snapshot?: UsageSnapshot;
  /** Set after a failed poll; cleared by the next success. */
  error?: UsageFailure;
  /** Plan type and tier from the credentials, like "team (default_claude_max_5x)". */
  plan?: string;
  /** True while a poll is in flight. */
  refreshing: boolean;
}

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
 * soon as focus returns; consecutive failures back off exponentially up to ten minutes.
 */
export class UsagePoller implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<UsageState>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private failures = 0;
  private inFlight: Promise<void> | undefined;
  private settings = readUsageSettings();
  private focused = vscode.window.state.focused;
  private disposed = false;
  // Token lives here only; re-read near expiry or after the server rejects it.
  private readonly credentials = new CredentialsCache();
  state: UsageState = { refreshing: false };

  constructor(private readonly version: string) {
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
        this.failures = 0;
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

  start(): void {
    if (this.settings.enabled) void this.refresh();
  }

  /** Poll now. Concurrent calls share the in-flight request. */
  refresh(): Promise<void> {
    if (!this.settings.enabled || this.disposed) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearTimer();
    this.state = { ...this.state, refreshing: true };
    this.emit();
    this.inFlight = this.poll().finally(() => {
      this.inFlight = undefined;
      this.schedule();
    });
    return this.inFlight;
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    try {
      const creds = await this.credentials.get(now);
      if (!creds) throw new UsageError("no-credentials", "No credentials.");
      const plan = creds.subscriptionType
        ? creds.rateLimitTier
          ? `${creds.subscriptionType} (${creds.rateLimitTier})`
          : creds.subscriptionType
        : undefined;
      if (creds.expiresAt !== undefined && creds.expiresAt <= now) {
        throw new UsageError("token-expired", "Token expired.");
      }
      const snapshot = await fetchUsage(creds.accessToken, { version: this.version });
      this.failures = 0;
      this.state = { snapshot, plan, refreshing: false };
    } catch (err) {
      this.failures++;
      if (err instanceof UsageError && err.unauthorized) this.credentials.invalidate();
      const reason: UsageErrorReason = err instanceof UsageError ? err.reason : "network";
      const message = err instanceof Error ? err.message : String(err);
      this.state = { ...this.state, error: { reason, message, at: Date.now() }, refreshing: false };
    }
    this.emit();
  }

  private schedule(): void {
    this.clearTimer();
    if (this.disposed || !this.settings.enabled || !this.focused) return;
    const delay = nextDelayMs(this.settings.intervalMs, this.failures);
    this.timer = setTimeout(() => void this.refresh(), delay);
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
