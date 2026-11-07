import * as fs from "node:fs";
import { claudeJsonPath, parseAccountUuid } from "./credentials";

/** ~/.claude.json as read for the account check: its text and when it was last written. */
export interface ClaudeJsonRead {
  raw: string;
  mtimeMs: number;
}

export interface AccountWatchDeps {
  /** Read ~/.claude.json; undefined when it is missing or unreadable. */
  read(): Promise<ClaudeJsonRead | undefined>;
  /**
   * The signed-in account changed. `at` is when ~/.claude.json was written, so every window that
   * notices the same change reports the same moment.
   */
  onSwitch(at: number): void;
  now(): number;
  log(line: string): void;
}

/**
 * Notices an account switch from oauthAccount.accountUuid in ~/.claude.json, whoever made it
 * (`claude auth login`, `/login` inside Claude Code, another window). Only the id is compared.
 */
export class AccountWatcher {
  private lastUuid: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: AccountWatchDeps) {}

  /** Remember the account signed in now, without reporting it as a switch. */
  init(): Promise<void> {
    return this.serial(async () => {
      const r = await this.deps.read();
      this.lastUuid = r ? parseAccountUuid(r.raw) : undefined;
    });
  }

  /**
   * Read the file again; report a switch when the account id differs from the last one seen here.
   * A missing file or a file without an account is no switch (a sign-out, or a write in progress).
   */
  check(): Promise<boolean> {
    return this.serial(async () => {
      const r = await this.deps.read();
      const uuid = r ? parseAccountUuid(r.raw) : undefined;
      if (!r || uuid === undefined || uuid === this.lastUuid) return false;
      this.lastUuid = uuid;
      this.deps.log(`${new Date(this.deps.now()).toISOString()} account change detected (~/.claude.json)`);
      this.deps.onSwitch(Math.floor(r.mtimeMs));
      return true;
    });
  }

  /**
   * For a manual refresh that found a new token: read the file and, when the account id differs from
   * the last one seen here, take it as seen and return the file's write time (the switch's epoch).
   * Undefined when the account is the same or unreadable: the new token is a renewal. Reports nothing
   * through onSwitch; the caller applies the switch.
   */
  takeSwitch(): Promise<number | undefined> {
    return this.serial(async () => {
      const r = await this.deps.read();
      const uuid = r ? parseAccountUuid(r.raw) : undefined;
      if (!r || uuid === undefined || uuid === this.lastUuid) return undefined;
      this.lastUuid = uuid;
      return Math.floor(r.mtimeMs);
    });
  }

  /** One read at a time, so two quick changes never both report the same switch. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.queue.then(f, f);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

export async function readClaudeJson(file = claudeJsonPath()): Promise<ClaudeJsonRead | undefined> {
  try {
    const [raw, st] = await Promise.all([fs.promises.readFile(file, "utf8"), fs.promises.stat(file)]);
    return { raw, mtimeMs: st.mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Call `onChange` (debounced) when ~/.claude.json is written. fs.watchFile polls the path's mtime,
 * so it keeps working across the atomic temp-file-and-rename writes Claude Code makes, and costs one
 * stat per interval.
 */
export function watchClaudeJson(onChange: () => void, file = claudeJsonPath(), opts: { debounceMs?: number; intervalMs?: number } = {}): () => void {
  const debounceMs = opts.debounceMs ?? 500;
  let timer: NodeJS.Timeout | undefined;
  const listener = (cur: fs.Stats, prev: fs.Stats): void => {
    if (cur.mtimeMs === prev.mtimeMs && cur.ino === prev.ino && cur.size === prev.size) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  try {
    fs.watchFile(file, { interval: opts.intervalMs ?? 1_000, persistent: false }, listener);
  } catch {
    return () => {};
  }
  return () => {
    if (timer) clearTimeout(timer);
    fs.unwatchFile(file, listener);
  };
}
