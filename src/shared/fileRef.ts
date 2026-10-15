/** A file path mentioned in text, with the optional :LINE or :LINE:COL suffix split off. */
export interface FileRef {
  path: string;
  line?: number;
  column?: number;
}

/** Characters that never appear in a path worth linking: whitespace, globs, quotes, shell syntax. */
const FORBIDDEN = /[\s*?{}<>|"'`()[\]$;,]/;
const SUFFIX = /:(\d+)(?::(\d+))?$/;
const EXTENSION = /\.[A-Za-z0-9]{1,16}$/;
const MAX_LENGTH = 512;

/**
 * Whether a piece of inline text looks like a file path: absolute (/x), home-relative (~/x), or
 * relative with at least one slash and a file extension (src/a.ts, ./a.ts). URLs, bare words,
 * version numbers and anything with spaces are left alone.
 */
export function parseFileRef(text: string): FileRef | undefined {
  const s = text.trim();
  if (!s || s.length > MAX_LENGTH || FORBIDDEN.test(s)) return undefined;
  if (s.includes("://") || s.startsWith("www.")) return undefined;
  const m = SUFFIX.exec(s);
  const path = m ? s.slice(0, m.index) : s;
  if (!path || path.endsWith("/") || path.includes("//")) return undefined;
  const absolute = path.startsWith("/");
  const home = path.startsWith("~/");
  const relative = !absolute && !home && path.includes("/") && EXTENSION.test(path);
  if (!absolute && !home && !relative) return undefined;
  if (absolute && path.length < 2) return undefined;
  const ref: FileRef = { path };
  if (m) {
    const line = Number(m[1]);
    if (!Number.isFinite(line) || line < 1) return undefined;
    ref.line = line;
    if (m[2] !== undefined) {
      const column = Number(m[2]);
      if (!Number.isFinite(column) || column < 1) return undefined;
      ref.column = column;
    }
  }
  return ref;
}
