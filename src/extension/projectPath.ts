import * as fs from "node:fs";

/** Consecutive tokens allowed to form a non-existing prefix before a branch is abandoned. */
const MAX_MISSES = 3;

interface Token {
  text: string;
  /** Preceded by an empty token (two dashes), so it most likely starts with ".". */
  dotted: boolean;
}

/**
 * Claude Code names project folders by replacing "/", "." and " " in the cwd with "-".
 * Decoding is ambiguous, so search the filesystem: at each token try "/", ".", "-", then " "
 * and prefer candidates that exist. Prefixes may be missing for a few tokens (for example
 * "cc" and "cc-history" before "cc-history-ext" exists). If no existing path is found at all,
 * assume "/" everywhere. Used only for session files that never recorded a cwd.
 */
export function decodeProjectDirName(name: string, exists: (p: string) => boolean = fs.existsSync): string {
  if (!name.startsWith("-")) return name;
  const tokens = tokenize(name.slice(1));
  if (tokens.length === 0) return "/";
  const found = search(tokens, exists, "", 0, 0);
  return found ?? tokens.map((t) => (t.dotted ? `/.${t.text}` : `/${t.text}`)).join("");
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let dotted = false;
  for (const part of s.split("-")) {
    if (part === "") {
      dotted = true;
      continue;
    }
    out.push({ text: part, dotted });
    dotted = false;
  }
  return out;
}

function candidates(current: string, t: Token): string[] {
  if (current === "") return [`/${t.dotted ? "." : ""}${t.text}`];
  if (t.dotted) return [`${current}/.${t.text}`, `${current}/-${t.text}`, `${current}.-${t.text}`, `${current}--${t.text}`];
  return [`${current}/${t.text}`, `${current}.${t.text}`, `${current}-${t.text}`, `${current} ${t.text}`];
}

function search(
  tokens: Token[],
  exists: (p: string) => boolean,
  current: string,
  i: number,
  misses: number,
): string | undefined {
  if (i === tokens.length) return exists(current) ? current : undefined;
  const cands = candidates(current, tokens[i]);
  const existing = cands.filter((c) => exists(c));
  for (const c of existing) {
    const r = search(tokens, exists, c, i + 1, 0);
    if (r) return r;
  }
  if (misses >= MAX_MISSES) return undefined;
  for (const c of cands) {
    if (existing.includes(c)) continue;
    const r = search(tokens, exists, c, i + 1, misses + 1);
    if (r) return r;
  }
  return undefined;
}
