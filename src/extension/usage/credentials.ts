import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * The OAuth token Claude Code keeps for claude.ai. It is read once per token lifetime, kept only
 * in memory and used for one request at a time; it is never logged, stored or refreshed here
 * (Claude Code rotates it).
 */
export interface Credentials {
  accessToken: string;
  /** Epoch ms; undefined when the file does not say. */
  expiresAt?: number;
  subscriptionType?: string;
  rateLimitTier?: string;
}

export const KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_TIMEOUT_MS = 5_000;

export function credentialsFilePath(home = os.homedir()): string {
  return path.join(home, ".claude", ".credentials.json");
}

/** Pull the claude.ai OAuth block out of the credentials JSON; undefined when there is none. */
export function parseCredentials(raw: string): Credentials | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof data !== "object" || data === null) return undefined;
  const oauth = (data as { claudeAiOauth?: unknown }).claudeAiOauth;
  if (typeof oauth !== "object" || oauth === null) return undefined;
  const o = oauth as Record<string, unknown>;
  if (typeof o.accessToken !== "string" || !o.accessToken) return undefined;
  const out: Credentials = { accessToken: o.accessToken };
  if (typeof o.expiresAt === "number" && Number.isFinite(o.expiresAt)) out.expiresAt = o.expiresAt;
  if (typeof o.subscriptionType === "string") out.subscriptionType = o.subscriptionType;
  if (typeof o.rateLimitTier === "string") out.rateLimitTier = o.rateLimitTier;
  return out;
}

function readKeychain(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined),
    );
  });
}

async function readFile(p: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

/** macOS reads the Keychain entry Claude Code writes; elsewhere the credentials file. Both may be absent. */
export async function readCredentials(platform = process.platform): Promise<Credentials | undefined> {
  const raw = platform === "darwin" ? (await readKeychain()) ?? (await readFile(credentialsFilePath())) : await readFile(credentialsFilePath());
  return raw ? parseCredentials(raw) : undefined;
}

/** Reuse a read token until this close to its expiry, then read again. */
export const REFRESH_MARGIN_MS = 60_000;

/**
 * In-memory cache in front of readCredentials, so the Keychain is read once per token lifetime
 * instead of once per poll. Nothing here touches disk or globalState.
 */
export class CredentialsCache {
  private cached: Credentials | undefined;

  constructor(
    private readonly reader: () => Promise<Credentials | undefined> = () => readCredentials(),
    private readonly marginMs = REFRESH_MARGIN_MS,
  ) {}

  /** The cached credentials while they are fresh, otherwise a new read (which may still be absent). */
  async get(now = Date.now()): Promise<Credentials | undefined> {
    if (this.cached && this.fresh(this.cached, now)) return this.cached;
    this.cached = await this.reader();
    return this.cached;
  }

  /** Drop the token, for example after the server rejected it. */
  invalidate(): void {
    this.cached = undefined;
  }

  private fresh(c: Credentials, now: number): boolean {
    return c.expiresAt === undefined || now < c.expiresAt - this.marginMs;
  }
}
