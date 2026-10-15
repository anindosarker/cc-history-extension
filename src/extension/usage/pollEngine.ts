import type { Credentials } from "./credentials";
import { CREDENTIAL_RETRY_MS, nextDelayMs } from "./schedule";
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

  constructor(private readonly deps: PollDeps) {}

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
      if (isCredentialFailure(reason, status)) {
        // Not our failure to back off from: keep looking for the rotated token on a short cycle.
        delayMs = CREDENTIAL_RETRY_MS;
      } else {
        this.failures++;
        delayMs = nextDelayMs(intervalMs, this.failures);
      }
      this.state = {
        ...this.state,
        error: { reason, message, ...(status !== undefined ? { status } : {}), at, since },
        refreshing: false,
      };
      this.deps.log(
        `${new Date(at).toISOString()} poll failed: ${reason}${status !== undefined ? ` (http ${status})` : ""}, next in ${seconds(delayMs)}`,
      );
      return { state: this.state, delayMs };
    }
  }

  /** Forget the failure streak, for example when settings change. */
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
