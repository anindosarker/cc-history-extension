import type { LockInfo } from "./fetchLock";
import type { PollEngine, UsageState } from "./pollEngine";
import { FOCUS_STALE_MS, LOCK_MAX_AGE_MS, RESET_GRACE_MS } from "./schedule";
import { cacheDecision, type CacheAction, type UsageCacheFile } from "./sharedCache";

/**
 * auto: the background timer (leader only), at most once per poll interval across windows.
 * focus: window focus or opening the usage panel, only when the latest attempt is five minutes old.
 * manual: the Refresh button, Retry or the command; always fetches unless rate limited after a 429.
 */
export type RefreshSource = "auto" | "focus" | "manual";

export interface RefresherDeps {
  engine: PollEngine;
  readCache(): Promise<UsageCacheFile | undefined>;
  /** Read-change-write of the shared cache file; failures are logged, never thrown. */
  updateCache(change: (c: UsageCacheFile) => UsageCacheFile): Promise<void>;
  /** The exclusive fetch lock shared by every window (fetchLock.ts). */
  lock: {
    tryAcquire(): LockInfo | undefined;
    holder(): LockInfo | undefined;
    release(lock: LockInfo): void;
  };
  /** Resolve true once lock `id` is released, false at `deadline` or when cancelled. */
  waitForRelease(id: string, deadline: number): Promise<boolean>;
  /** True once the window is closing: stop waiting and write nothing more. */
  cancelled(): boolean;
  /** Drop the cached token so the next fetch reads the credentials again. */
  invalidateCredentials(): void;
  /**
   * Read the credentials past the cache and say whether the token differs from the cached one
   * (compared by digest); a new token replaces the cached one. A manual refresh asks first;
   * background refreshes never do.
   */
  tokenChanged?(): Promise<boolean>;
  /**
   * After a new token: the epoch of an account switch when ~/.claude.json names another account than
   * the one last seen (taking it as seen), or undefined for the same account (a renewal).
   */
  accountSwitchedAt?(): Promise<number | undefined>;
  now(): number;
  intervalMs(): number;
  log(line: string): void;
  /** The state changed: re-render. */
  onChange(): void;
}

/**
 * Decides, per refresh request, whether to fetch, use what another window fetched, or wait. Only the
 * holder of the fetch lock fetches and writes usage.json. Concurrent requests join the run in flight.
 */
export class UsageRefresher {
  private inFlight: Promise<void> | undefined;
  private inFlightSource: RefreshSource | undefined;
  /** When this window last finished an attempt or took over another window's. */
  private lastAttemptAt = 0;
  /** Set after an account switch: the next run ignores the old account's rate limit and fetches. */
  private forceNext = false;
  /** The latest account switch this window has applied (credentialsEpoch in usage.json). */
  private seenEpoch = 0;
  /** Delay before the next background poll, decided by the last run. */
  nextDelayMs: number;

  constructor(private readonly deps: RefresherDeps) {
    this.nextDelayMs = deps.intervalMs();
  }

  get busy(): boolean {
    return this.inFlight !== undefined;
  }

  /** Resolves when no run is in flight. */
  settled(): Promise<void> {
    return (this.inFlight ?? Promise.resolve()).then(() => (this.inFlight ? this.settled() : undefined));
  }

  /** Note an attempt a window really made, so polls space themselves from it. */
  noteAttempt(at: number | undefined): void {
    if (at !== undefined && at > this.lastAttemptAt) this.lastAttemptAt = at;
  }

  /**
   * Apply an account switch recorded in the cache, by any window: drop the cached token and every
   * number, label and rate limit of the old account. Returns true when it was new here.
   */
  checkEpoch(cache: UsageCacheFile | undefined): boolean {
    const epoch = cache?.credentialsEpoch ?? 0;
    if (epoch <= this.seenEpoch) return false;
    this.seenEpoch = epoch;
    this.deps.invalidateCredentials();
    this.deps.engine.forgetAccount();
    this.lastAttemptAt = 0;
    this.deps.log(`${new Date(this.deps.now()).toISOString()} account switched (epoch ${epoch}), credentials will be read again`);
    return true;
  }

  /** Take in what another window wrote: an account switch, its numbers, error and rate limit. */
  observe(cache: UsageCacheFile | undefined): boolean {
    const switched = this.checkEpoch(cache);
    if (!cache) return switched;
    this.noteAttempt(cache.attemptedAt);
    return this.deps.engine.adopt(cache) || switched;
  }

  /**
   * This window noticed an account switch: record a new epoch in usage.json (wiping the old account's
   * numbers for every window) and make the next run fetch with the new credentials. `at` is when the
   * switch happened (the ~/.claude.json write), so windows noticing the same change agree on it.
   * Returns false, changing nothing, when this window or usage.json already has that switch or a
   * later one: another window applied it and fetches (or fetched) for it.
   */
  async switchAccount(at?: number): Promise<boolean> {
    const epoch = at ?? Math.max(this.deps.now(), this.seenEpoch + 1);
    if (epoch <= this.seenEpoch) return false;
    const cache = await this.deps.readCache();
    if ((cache?.credentialsEpoch ?? 0) >= epoch) {
      if (this.observe(cache)) this.deps.onChange();
      return false;
    }
    this.checkEpoch({ credentialsEpoch: epoch });
    this.forceNext = true;
    this.deps.onChange();
    // Two windows writing the same epoch write the same thing; a result fetched for it stays.
    await this.deps.updateCache((c) => ((c.credentialsEpoch ?? 0) >= epoch ? c : { credentialsEpoch: epoch }));
    return true;
  }

  /**
   * Apply an account switch (see switchAccount) and, when it was new, fetch for the new account.
   * Returns whether it was new.
   */
  async accountChanged(at?: number): Promise<boolean> {
    if (!(await this.switchAccount(at))) return false;
    await this.settled();
    this.forceNext = true;
    await this.refresh("manual");
    return true;
  }

  /**
   * The Refresh button: when the token on disk is not the cached one and ~/.claude.json names another
   * account, the account was switched behind this window's back, so switch first. A new token for the
   * same account is a renewal: it is used, and the refresh stays an ordinary one (a rate limit holds).
   */
  async manualRefresh(): Promise<void> {
    if (!this.inFlight && this.deps.tokenChanged && (await this.deps.tokenChanged())) {
      const at = await this.deps.accountSwitchedAt?.();
      if (at !== undefined) {
        this.deps.log(`${new Date(this.deps.now()).toISOString()} account change detected (new token on refresh)`);
        if (await this.accountChanged(at)) return;
      }
    }
    return this.refresh("manual");
  }

  refresh(source: RefreshSource): Promise<void> {
    if (this.inFlight) {
      // A manual click joins a manual run, but a background check may decide not to fetch: follow it,
      // unless an attempt finished after the click (then that is the answer).
      if (source !== "manual" || this.inFlightSource === "manual") return this.inFlight;
      const clickedAt = this.deps.now();
      return this.inFlight.then(() => (this.lastAttemptAt >= clickedAt ? undefined : this.refresh(source)));
    }
    if (source === "manual" && !this.forceNext) {
      const until = this.deps.engine.state.retryUntil;
      if (until !== undefined && until > this.deps.now()) {
        this.deps.log(`${new Date(this.deps.now()).toISOString()} manual refresh refused: rate limited until ${new Date(until).toISOString()}`);
        this.deps.onChange();
        return Promise.resolve();
      }
    }
    this.inFlightSource = source;
    if (source === "manual") {
      // Spinner from the click on, also while waiting for another window.
      this.deps.engine.state = { ...this.deps.engine.state, refreshing: true };
      this.deps.onChange();
    }
    this.inFlight = this.run(source).finally(() => {
      this.inFlight = undefined;
      this.inFlightSource = undefined;
      this.deps.engine.state = { ...this.deps.engine.state, refreshing: false };
      this.deps.onChange();
    });
    return this.inFlight;
  }

  private async run(source: RefreshSource): Promise<void> {
    const forced = this.forceNext;
    this.forceNext = false;
    const manual = source === "manual" || forced;
    for (let pass = 0; pass < 3 && !this.deps.cancelled(); pass++) {
      const d = await this.decide(source, forced, this.deps.now());
      if (d.action !== "fetch") return this.settle(d, source);
      const lock = this.deps.lock.tryAcquire();
      if (lock) {
        try {
          // Re-check under the lock: another window may have finished a fetch just now.
          const again = await this.decide(source, forced, this.deps.now());
          if (again.action !== "fetch") return this.settle(again, source);
          await this.fetch();
        } finally {
          this.deps.lock.release(lock);
        }
        return;
      }
      const holder = this.deps.lock.holder();
      if (!manual) {
        // The holder's write reaches this window through the cache watcher.
        this.nextDelayMs = LOCK_MAX_AGE_MS;
        this.deps.log(`${new Date(this.deps.now()).toISOString()} another window is fetching usage, ${source} refresh skipped`);
        return;
      }
      if (!holder) continue;
      this.deps.log(`${new Date(this.deps.now()).toISOString()} another window is fetching usage, waiting for its result`);
      const released = await this.deps.waitForRelease(holder.id, holder.at + LOCK_MAX_AGE_MS);
      if (this.deps.cancelled()) return;
      if (released) {
        const cache = await this.deps.readCache();
        const attempted = cache?.attemptedAt !== undefined && cache.attemptedAt >= holder.at;
        // After an account switch, take the holder's result only when it was written for this switch
        // (a fetch started before it is never written); otherwise the old token may have made it.
        const usable = attempted && (!forced || (cache?.credentialsEpoch ?? 0) >= this.seenEpoch);
        if (!forced || usable) {
          if (this.observe(cache)) this.deps.onChange();
        } else if (this.checkEpoch(cache)) this.deps.onChange();
        if (usable) {
          this.nextDelayMs = this.deps.intervalMs();
          return;
        }
      }
      if (!released) this.deps.log(`${new Date(this.deps.now()).toISOString()} the other window did not answer in time, taking the lock`);
      // Next pass: take the lock (a stale one is cleared) and fetch here.
    }
  }

  /** Read the shared cache, take over what is newer, and decide what this kind of refresh does. */
  private async decide(source: RefreshSource, forced: boolean, now: number): Promise<CacheAction> {
    const cache = await this.deps.readCache();
    if (this.checkEpoch(cache)) this.deps.onChange();
    // usage.json is wiped at each switch, so an attempt recorded under the current epoch was made for
    // the new account: another window that noticed the same switch already fetched.
    if (forced && cache?.attemptedAt !== undefined && (cache.credentialsEpoch ?? 0) >= this.seenEpoch && this.seenEpoch > 0) {
      if (this.deps.engine.adopt(cache)) this.deps.onChange();
      this.noteAttempt(cache.attemptedAt);
      return { action: "fresh", until: cache.attemptedAt + this.deps.intervalMs() };
    }
    if (cache && !forced) {
      if (this.deps.engine.adopt(cache)) this.deps.onChange();
      this.noteAttempt(cache.attemptedAt);
    }
    const minAgeMs = source === "manual" || forced ? 0 : source === "focus" ? FOCUS_STALE_MS : this.deps.intervalMs();
    return cacheDecision({ cache, now, minAgeMs, localAttemptedAt: forced ? undefined : this.lastAttemptAt, ignoreRetryAfter: forced });
  }

  private settle(d: Exclude<CacheAction, { action: "fetch" }>, source: RefreshSource): void {
    const now = this.deps.now();
    this.nextDelayMs = Math.max(0, d.until - now);
    if (d.action === "retry-after") this.deps.engine.state = { ...this.deps.engine.state, retryUntil: d.until };
    this.deps.log(`${new Date(now).toISOString()} ${describeDecision(d, now, source)}`);
  }

  /** Fetch and write the result; called only while holding the fetch lock. */
  private async fetch(): Promise<void> {
    const { engine } = this.deps;
    const epochAtStart = this.seenEpoch;
    engine.state = { ...engine.state, refreshing: true };
    this.deps.onChange();
    const outcome = await engine.pollOnce(this.deps.intervalMs());
    if (this.deps.cancelled()) return;
    const at = this.deps.now();
    const s = outcome.state;
    let discarded = false;
    await this.deps.updateCache((c) => {
      // An account switch happened while this fetch ran: its credentials were the old account's.
      if ((c.credentialsEpoch ?? 0) > epochAtStart) {
        discarded = true;
        return c;
      }
      const { retryUntil: oldRetry, ...keep } = c;
      if (s.snapshot && !s.error) {
        const { lastError: _e, plan: _p, account: _a, ...fresh } = keep;
        return {
          ...fresh,
          fetchedAt: s.snapshot.fetchedAt,
          snapshot: s.snapshot,
          attemptedAt: at,
          ...(s.plan !== undefined ? { plan: s.plan } : {}),
          ...(s.account !== undefined ? { account: s.account } : {}),
        };
      }
      const next: UsageCacheFile = { ...keep, attemptedAt: at };
      if (s.error) {
        const { reason, message, status } = s.error;
        next.lastError = { reason, message, ...(status !== undefined ? { status } : {}), at: s.error.at };
      }
      // A rate limit never goes backwards.
      const retry = Math.max(oldRetry ?? 0, outcome.rateLimited?.retryUntil ?? 0);
      if (retry > at) next.retryUntil = retry;
      return next;
    });
    if (discarded) {
      this.deps.log(`${new Date(at).toISOString()} result discarded: the account was switched while it was fetched`);
      this.checkEpoch(await this.deps.readCache());
      engine.forgetAccount();
      return;
    }
    this.lastAttemptAt = at;
    this.nextDelayMs = outcome.delayMs;
  }
}

/**
 * When the background poll fires next, or undefined for no timer: followers never poll on a timer.
 * The leader waits the delay the last run chose, comes back early after a window resets, and never
 * fires inside a rate limit.
 */
export function nextPollDelay(state: UsageState, delayMs: number, isLeader: boolean, now: number): number | undefined {
  if (!isLeader) return undefined;
  let delay = delayMs;
  const snap = state.snapshot;
  if (snap) {
    const resets = [snap.fiveHour, snap.weekly, ...snap.scoped]
      .map((l) => l?.resetsAt)
      .filter((r): r is number => r !== undefined && r > now);
    if (resets.length) delay = Math.min(delay, Math.min(...resets) + RESET_GRACE_MS - now);
  }
  if (state.retryUntil !== undefined) delay = Math.max(delay, state.retryUntil - now);
  return Math.max(1_000, delay);
}

function describeDecision(d: Exclude<CacheAction, { action: "fetch" }>, now: number, source: RefreshSource): string {
  const inS = `${Math.round((d.until - now) / 1000)}s`;
  switch (d.action) {
    case "fresh":
      return `${source} refresh skipped: usage was fetched recently, next poll in ${inS}`;
    case "retry-after":
      return `rate limited after a 429, no fetch for ${inS}`;
  }
}

