import type { UsageAccount } from "../../shared/usage";
import type { Credentials } from "./credentials";
import { RATE_LIMIT_HOLD_MS, rateLimitDelayMs } from "./schedule";
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
  /** Signed-in email and organization. */
  account?: UsageAccount;
  /** True while a refresh is under way, including while waiting for another window's fetch. */
  refreshing: boolean;
  /** After a 429: no fetch, manual included, before this time (Retry-After, at least a minute). */
  retryUntil?: number;
}

export interface PollDeps {
  /** Credentials, from the cache unless fresh is set. */
  readCredentials(now: number, opts: { fresh: boolean }): Promise<Credentials | undefined>;
  /** Drop the cached token so the next attempt reads it again. */
  invalidateCredentials(): void;
  fetchUsage(accessToken: string): Promise<UsageSnapshot>;
  now(): number;
  /** One line per event; never receives tokens or headers. */
  log(line: string): void;
}

export interface PollOutcome {
  state: UsageState;
  /** How long to wait before the next background poll. */
  delayMs: number;
  /** Set when the server answered 429. */
  rateLimited?: { retryAfterMs?: number; retryUntil: number };
}

/** Missing, expired or rejected tokens: the next attempt re-reads the credentials. */
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
 * One fetch attempt with no VS Code, timer or file dependencies: returns the next state and the delay
 * before the next background poll. A failure keeps the last good snapshot; every failure waits a
 * full interval (or the server's longer Retry-After), with no ladder and no pause.
 */
export class PollEngine {
  state: UsageState = { refreshing: false };

  constructor(private readonly deps: PollDeps) {}

  /**
   * Take over what another window wrote, when it is newer than ours: its snapshot, its latest error
   * and its Retry-After. Returns true when anything changed.
   */
  adopt(cache: UsageCacheFile): boolean {
    let changed = false;
    if (cache.snapshot && cache.fetchedAt !== undefined && cache.fetchedAt > (this.state.snapshot?.fetchedAt ?? 0)) {
      const snapshot: UsageSnapshot = { ...cache.snapshot, fetchedAt: cache.fetchedAt };
      // Plan and account as written: after a switch to an account without them, the old ones must go.
      const { plan: _p, account: _a, ...rest } = this.state;
      this.state = { ...rest, snapshot, ...(cache.plan !== undefined ? { plan: cache.plan } : {}), ...(cache.account ? { account: cache.account } : {}) };
      if (this.state.error && this.state.error.at <= cache.fetchedAt) {
        const { error: _cleared, ...rest } = this.state;
        this.state = rest;
      }
      changed = true;
    }
    const e = cache.lastError;
    const latestHere = Math.max(this.state.error?.at ?? 0, this.state.snapshot?.fetchedAt ?? 0);
    if (e && e.at > latestHere) {
      const since = this.state.error?.since ?? e.at;
      this.state = { ...this.state, error: { reason: e.reason, message: e.message, ...(e.status !== undefined ? { status: e.status } : {}), at: e.at, since } };
      changed = true;
    }
    if (cache.retryUntil !== undefined && cache.retryUntil > this.deps.now() && cache.retryUntil !== this.state.retryUntil) {
      this.state = { ...this.state, retryUntil: cache.retryUntil };
      changed = true;
    }
    return changed;
  }

  /** Forget everything about the previous account: its numbers, plan, label, error and rate limit. */
  forgetAccount(): void {
    this.state = { refreshing: this.state.refreshing };
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
      this.state = { snapshot, plan: planOf(creds), ...(creds.account ? { account: creds.account } : {}), refreshing: false };
      this.deps.log(`${new Date(this.deps.now()).toISOString()} poll ok (${summary(snapshot)}), next in ${seconds(intervalMs)}`);
      return { state: this.state, delayMs: intervalMs };
    } catch (err) {
      const reason: UsageErrorReason = err instanceof UsageError ? err.reason : "network";
      const status = err instanceof UsageError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      // A rejected, expired or missing token: read the credentials again on the next attempt.
      if (isCredentialFailure(reason, status)) this.deps.invalidateCredentials();
      const at = this.deps.now();
      const since = this.state.error?.since ?? at;
      const { retryUntil: _old, ...rest } = this.state;
      this.state = { ...rest, error: { reason, message, ...(status !== undefined ? { status } : {}), at, since }, refreshing: false };
      if (status === 429) {
        const retryAfterMs = err instanceof UsageError ? err.retryAfterMs : undefined;
        const delayMs = rateLimitDelayMs(retryAfterMs, intervalMs);
        // Even without Retry-After, a minute's hold keeps repeated clicks off a limited endpoint.
        const retryUntil = at + Math.max(retryAfterMs ?? 0, RATE_LIMIT_HOLD_MS);
        this.state = { ...this.state, retryUntil };
        const ra = retryAfterMs === undefined ? "no Retry-After" : `Retry-After ${seconds(retryAfterMs)}`;
        this.deps.log(`${new Date(at).toISOString()} HTTP 429 Too Many Requests (${ra}), keeping the last numbers, next in ${seconds(delayMs)}`);
        return { state: this.state, delayMs, rateLimited: { retryAfterMs, retryUntil } };
      }
      this.deps.log(
        `${new Date(at).toISOString()} poll failed: ${reason}${status !== undefined ? ` (http ${status})` : ""}, next in ${seconds(intervalMs)}`,
      );
      return { state: this.state, delayMs: intervalMs };
    }
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
