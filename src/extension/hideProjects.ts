import picomatch from "picomatch";
import type { SessionMeta } from "../shared/types";

export const DEFAULT_HIDDEN_PROJECTS: readonly string[] = ["/private/var/folders/**", "/tmp/**"];

/** Matches a project working directory against the ccHistory.tree.hideProjects globs. */
export function hiddenProjectMatcher(patterns: readonly string[]): (cwd: string) => boolean {
  const globs = patterns.map((p) => p.trim()).filter(Boolean);
  if (globs.length === 0) return () => false;
  const matchers = globs.map((g) => {
    try {
      return picomatch(g.replace(/\\/g, "/"), { dot: true });
    } catch {
      return undefined;
    }
  });
  const valid = matchers.filter((m): m is (input: string) => boolean => m !== undefined);
  if (valid.length === 0) return () => false;
  return (cwd) => {
    const p = cwd.replace(/\\/g, "/");
    return valid.some((m) => m(p));
  };
}

export function isHiddenProject(cwd: string, patterns: readonly string[]): boolean {
  return hiddenProjectMatcher(patterns)(cwd);
}

/** Sessions whose project is not hidden; the input order is kept. */
export function visibleSessions(sessions: readonly SessionMeta[], patterns: readonly string[]): SessionMeta[] {
  const hidden = hiddenProjectMatcher(patterns);
  return sessions.filter((s) => !hidden(s.cwd));
}
