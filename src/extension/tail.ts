import * as fs from "node:fs";
import { tryParseJson } from "./jsonl";

/**
 * Bytes at the start of the file remembered to notice a rewrite in place. Every Claude Code record
 * starts with the same keys, so the window reaches into the first prompt and the first uuid.
 */
export const HEAD_BYTES = 4096;
const NEWLINE = 0x0a;

export interface TailRead {
  /** Complete lines appended since the last read (or the whole file after a reset). */
  lines: string[];
  /** The file shrank or its first bytes changed: the caller must parse from scratch. */
  reset: boolean;
}

/**
 * Reads a growing jsonl file in increments, remembering the byte offset reached so far.
 * A partial trailing line is kept as bytes until its newline arrives, so multi-byte characters
 * split across reads survive. A line without a trailing newline is still delivered once it parses.
 */
export class TailReader {
  private offset = 0;
  private head: Buffer | undefined;
  private pending: Buffer = Buffer.alloc(0);

  constructor(readonly filePath: string) {}

  /** Bytes consumed so far, pending partial line included. */
  get position(): number {
    return this.offset;
  }

  /** Forget everything so the next read returns the whole file (as a reset). */
  invalidate(): void {
    this.offset = 0;
    this.head = undefined;
    this.pending = Buffer.alloc(0);
  }

  /** What changed since the last call, or undefined when the file did not grow. */
  async read(): Promise<TailRead | undefined> {
    const stat = await fs.promises.stat(this.filePath);
    const size = stat.size;
    const fh = await fs.promises.open(this.filePath, "r");
    try {
      let head = this.head;
      let reset = head === undefined || size < this.offset;
      if (!reset && head !== undefined) {
        // The remembered head may be shorter than HEAD_BYTES when the file was small; compare that much.
        const now = await readRange(fh, 0, head.length);
        if (!now.equals(head)) reset = true;
      }
      if (reset) {
        this.offset = 0;
        this.pending = Buffer.alloc(0);
      } else if (size === this.offset) {
        return undefined;
      }
      const chunk = await readRange(fh, this.offset, size - this.offset);
      if (head === undefined || reset || head.length < HEAD_BYTES) {
        head = await readRange(fh, 0, Math.min(HEAD_BYTES, size));
      }
      this.head = head;
      this.offset = size;
      const lines = this.splitLines(chunk);
      return { lines, reset };
    } finally {
      await fh.close();
    }
  }

  private splitLines(chunk: Buffer): string[] {
    const buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== NEWLINE) continue;
      const end = i > start && buf[i - 1] === 0x0d ? i - 1 : i;
      if (end > start) out.push(buf.toString("utf8", start, end));
      start = i + 1;
    }
    const rest = buf.subarray(start);
    // A final line with no newline yet: deliver it if it already parses, else wait for more bytes.
    if (rest.length > 0) {
      const text = rest.toString("utf8");
      if (tryParseJson(text) !== undefined) {
        out.push(text);
        this.pending = Buffer.alloc(0);
      } else {
        this.pending = Buffer.from(rest);
      }
    } else {
      this.pending = Buffer.alloc(0);
    }
    return out;
  }
}

async function readRange(fh: fs.promises.FileHandle, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, start);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}
