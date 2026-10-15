import * as fs from "node:fs";
import * as readline from "node:readline";

/**
 * Stream a .jsonl file line by line. Lines are passed raw; the caller parses.
 * Never loads the whole file; a single line may still be several megabytes.
 */
export async function forEachLine(
  filePath: string,
  onLine: (line: string) => void,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length === 0) continue;
      onLine(line);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

export function tryParseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
