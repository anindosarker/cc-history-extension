import * as os from "node:os";
import * as path from "node:path";

/**
 * Absolute path for a file reference from a transcript: "~/x" against the home directory,
 * a relative path against the session's working directory, an absolute one as is.
 */
export function resolveFilePath(p: string, cwd: string, home: string = os.homedir()): string {
  if (p === "~" || p.startsWith("~/")) return path.join(home, p.slice(1));
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(cwd, p);
}
