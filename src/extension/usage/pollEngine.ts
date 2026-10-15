import type { Credentials } from "./credentials";
import { CREDENTIAL_RETRY_MS, nextDelayMs, pausedAfter, rateLimitDelayMs } from "./schedule";
import type { UsageCacheFile } from "./sharedCache";
import { UsageError, type UsageErrorReason, type UsageSnapshot } from "./usageClient";

export interface UsageFailure {
  reason: UsageErrorReason;
  message: string;
  /** HTTP status for "http" failures. */
  status?: number;
  /** When this attempt failed. */
  at: number;
  /** When the current run of failures began; the token hint keys off how long it has lasted. */
  since: number;
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
  /** Automatic polling stopped after repeated 429s; a manual Refresh resumes it. */
  paused?: boolean;
  /** No fetch before this time (429 backoff, this window's or another's). */
  nextAllowedAt?: number;
  /** A manual refresh was asked too soon; "Please wait" until this time. */
  manualWaitUntil?: number;
}

export interface PollDeps {
  /** Credentials, from the cache unless fresh is set. */
  readCredentials(now: number, opts: { fresh: boolean }): Promise<Credentials | undefined>;
  /** Drop the cached token after the server rejected it. */
  invalidateCredentials(): void;
  fetchUsage(accessToken: string): Promise<UsageSnapshot>;
  now(): number;
  /** One line per event; never receives tokens or headers. */
  log(line: string): void;
}

export interface PollOutcome {
  state: UsageState;
  /** How long to wait before the next poll. */
  delayMs: number;
  /** Set when the server answered 429. */
  rateLimited?: { retryAfterMs?: number; consecutive: number; paused: boolean; nextAllowedAt: number };
}

/** Missing, expired or rejected tokens: Claude Code fixes these on its own, so they get a short fixed retry. */
export function isCredentialFailure(reason: UsageErrorReason, status?: number): boolean {
  return reason === "no-credentials" || reason === "token-expired" || (reason === "http" && (status === 401 || status === 403));
}

function planOf(c: Credentials): string | undefined {
  if (!c.subscriptionType) return undefined;
  return c.rateLimitTier ? `${c.subscriptionType} (${c.rateLimitTier})` : c.subscriptionType;
}

function expired(c: Credentials, now: number): boolean {
  return c.expiresAt !== undefined && c.expiresAt <= now;
}

function describe(c: Credentials): string {
  const exp = c.expiresAt === undefined ? "no expiry" : `expires ${new Date(c.expiresAt).toISOString()}`;
  return `credentials from ${c.source ?? "unknown"}, ${exp}`;
}

/**
 * The poll decision logic with no VS Code or timer dependencies: one call per attempt, returning the
 * next state and the delay to wait. The poller owns timers, focus and settings around it.
 */
export class PollEngine {
  state: UsageState = { refreshing: false };
  private failures = 0;
  private rateLimits = 0;

  constructor(private readonly deps: PollDeps) {}

  /** Consecutive 429s so far. */
  get consecutiveRateLimits(): number {
    return this.rateLimits;
  }

  /** Take over a snapshot another window fetched, when it is newer than ours. Returns true when adopted. */
  adopt(cache: UsageCacheFile): boolean {
    let changed = false;
    if (cache.snapshot && cache.fetchedAt !== undefined && cache.fetchedAt > (this.state.snapshot?.fetchedAt ?? 0)) {
      const snapshot: UsageSnapshot = { ...cache.snapshot, fetchedAt: cache.fetchedAt };
      const { error: _dropped, ...rest } = this.state;
      this.state = { ...rest, snapshot, plan: cache.plan ?? this.state.plan };
      this.failures = 0;
      changed = true;
    }
    if (cache.nextAllowedAt !== undefined && cache.nextAllowedAt > this.deps.now() && cache.nextAllowedAt !== this.state.nextAllowedAt) {
      this.state = { ...this.state, nextAllowedAt: cache.nextAllowedAt };
      changed = true;
    }
    return changed;
  }

  /** The user clicked Refresh: automatic polling may run again. */
  resume(): void {
    if (!this.state.paused) return;
    const { paused: _p, ...rest } = this.state;
    this.state = rest;
  }

  async pollOnce(intervalMs: number): Promise<PollOutcome> {
    const now = this.deps.now();
    try {
      let creds = await this.deps.readCredentials(now, { fresh: false });
      // Claude Code usually rotates the token within seconds of expiry, so look again before giving up.
      if (!creds || expired(creds, now)) {
        creds = await this.deps.readCredentials(now, { fresh: true });
      }
      if (!creds) throw new UsageError("no-credentials", "No credentials.");
      this.deps.log(describe(creds));
      if (expired(creds, now)) throw new UsageError("token-expired", "Token expired.");
      const snapshot = await this.deps.fetchUsage(creds.accessToken);
      this.failures = 0;
      this.rateLimits = 0;
      this.state = { snapshot, plan: planOf(creds), refreshing: false };
      const delayMs = intervalMs;
      this.deps.log(`${new Date(this.deps.now()).toISOString()} poll ok (${summary(snapshot)}), next in ${seconds(delayMs)}`);
      return { state: this.state, delayMs };
    } catch (err) {
      const reason: UsageErrorReason = err instanceof UsageError ? err.reason : "network";
      const status = err instanceof UsageError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof UsageError && err.unauthorized) this.deps.invalidateCredentials();
      const at = this.deps.now();
      const since = this.state.error?.since ?? at;
      let delayMs: number;
      let rateLimited: PollOutcome["rateLimited"];
      if (isCredentialFailure(reason, status)) {
        // Not our failure to back off from: keep looking for the rotated token on a short cycle.
        delayMs = CREDENTIAL_RETRY_MS;
      } else if (status === 429) {
        this.rateLimits++;
        const retryAfterMs = err instanceof UsageError ? err.retryAfterMs : undefined;
        delayMs = rateLimitDelayMs(retryAfterMs, this.rateLimits);
        rateLimited = { retryAfterMs, consecutive: this.rateLimits, paused: pausedAfter(this.rateLimits), nextAllowedAt: at + delayMs };
      } else {
        this.failures++;
        delayMs = nextDelayMs(intervalMs, this.failures);
      }
      this.state = {
        ...this.state,
        error: { reason, message, ...(status !== undefined ? { status } : {}), at, since },
        refreshing: false,
      };
      if (rateLimited) {
        this.state = { ...this.state, nextAllowedAt: rateLimited.nextAllowedAt, ...(rateLimited.paused ? { paused: true } : {}) };
        const ra = rateLimited.retryAfterMs === undefined ? "no Retry-After" : `Retry-After ${seconds(rateLimited.retryAfterMs)}`;
        this.deps.log(
          `${new Date(at).toISOString()} HTTP 429 Too Many Requests (${ra}), 429 #${rateLimited.consecutive} in a row, ` +
            (rateLimited.paused ? `automatic polling paused until Refresh is clicked (not before ${seconds(delayMs)})` : `next in ${seconds(delayMs)}`),
        );
        return { state: this.state, delayMs, rateLimited };
      }
      this.deps.log(
        `${new Date(at).toISOString()} poll failed: ${reason}${status !== undefined ? ` (http ${status})` : ""}, next in ${seconds(delayMs)}`,
      );
      return { state: this.state, delayMs };
    }
  }

  /** Forget the failure streak, for example when settings change. The 429 streak is kept on purpose. */
  reset(): void {
    this.failures = 0;
  }
}

function summary(s: UsageSnapshot): string {
  const parts: string[] = [];
  if (s.fiveHour) parts.push(`5h ${Math.round(s.fiveHour.pct)}%`);
  if (s.weekly) parts.push(`wk ${Math.round(s.weekly.pct)}%`);
  for (const x of s.scoped) parts.push(`${x.label} ${Math.round(x.pct)}%`);
  return parts.join(", ") || "no limits";
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}
