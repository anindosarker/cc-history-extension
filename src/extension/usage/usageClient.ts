import type { UsageErrorReason } from "../../shared/usage";

export type { UsageErrorReason };


export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const USAGE_TIMEOUT_MS = 10_000;

export interface UsageLimit {
  /** Percent of the window used, 0 to 100 (or more when the API says so). */
  pct: number;
  /** Epoch ms when the window resets. */
  resetsAt?: number;
}

export interface ScopedLimit extends UsageLimit {
  label: string;
}

export interface UsageSnapshot {
  fetchedAt: number;
  fiveHour?: UsageLimit;
  weekly?: UsageLimit;
  /** Per-model or scoped weekly shares such as Fable, Opus, Sonnet, plus extra usage when enabled. */
  scoped: ScopedLimit[];
}

export class UsageError extends Error {
  constructor(
    readonly reason: UsageErrorReason,
    message: string,
    /** HTTP status for "http" failures, so callers can tell a rejected token from an outage. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "UsageError";
  }

  /** True when the server rejected the token itself (401 or 403). */
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export const SCOPED_SHARE_LABEL = "Fable";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function when(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

function limit(v: unknown): UsageLimit | undefined {
  const o = obj(v);
  const pct = o ? num(o.utilization) : undefined;
  if (pct === undefined) return undefined;
  const out: UsageLimit = { pct };
  const resetsAt = o ? when(o.resets_at) : undefined;
  if (resetsAt !== undefined) out.resetsAt = resetsAt;
  return out;
}

/** Shape the usage endpoint's JSON into a snapshot. Unknown keys are ignored and nulls tolerated. */
export function parseUsage(json: unknown, fetchedAt: number): UsageSnapshot {
  const root = obj(json);
  if (!root) throw new UsageError("parse", "Usage response was not a JSON object.");
  const snap: UsageSnapshot = { fetchedAt, scoped: [] };
  const fiveHour = limit(root.five_hour);
  if (fiveHour) snap.fiveHour = fiveHour;
  const weekly = limit(root.seven_day);
  if (weekly) snap.weekly = weekly;

  const shares = Array.isArray(root.weekly_scoped_shares) ? root.weekly_scoped_shares : [];
  for (const share of shares) {
    const s = obj(share);
    const used = s ? num(s.used_percent_of_weekly) : undefined;
    const allowance = s ? num(s.allowance_percent_of_weekly) : undefined;
    if (used === undefined || allowance === undefined || allowance <= 0) continue;
    const scoped: ScopedLimit = { label: SCOPED_SHARE_LABEL, pct: (used / allowance) * 100 };
    if (weekly?.resetsAt !== undefined) scoped.resetsAt = weekly.resetsAt;
    snap.scoped.push(scoped);
  }
  for (const [key, label] of [
    ["seven_day_opus", "Opus"],
    ["seven_day_sonnet", "Sonnet"],
  ] as const) {
    const l = limit(root[key]);
    if (l) snap.scoped.push({ label, ...l });
  }
  const extra = obj(root.extra_usage);
  if (extra && extra.is_enabled === true) {
    const pct = num(extra.utilization);
    if (pct !== undefined) {
      const l: ScopedLimit = { label: "Extra", pct };
      const resetsAt = when(extra.resets_at);
      if (resetsAt !== undefined) l.resetsAt = resetsAt;
      snap.scoped.push(l);
    }
  }
  return snap;
}

export interface FetchOptions {
  /** Shown in the User-Agent header. */
  version: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

/** One GET against the usage endpoint with the bearer token; the token goes nowhere else. */
export async function fetchUsage(accessToken: string, opts: FetchOptions): Promise<UsageSnapshot> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new UsageError("network", "fetch is not available in this runtime.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? USAGE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": `cc-history/${opts.version}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new UsageError("network", aborted ? "Request timed out." : err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? " Sign in again with claude login." : "";
    throw new UsageError("http", `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.${hint}`, res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new UsageError("parse", "Usage response was not valid JSON.");
  }
  return parseUsage(json, (opts.now ?? Date.now)());
}
