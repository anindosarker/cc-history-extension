import type { SessionMeta } from "../../shared/types";
import { SEVEN_DAYS_MS, type WeekSummary } from "../../shared/usage";

const TOP_PROJECTS = 3;

/** Sessions started in the last seven days, their message total, and the busiest projects. */
export function weekSummary(sessions: readonly SessionMeta[], now: number): WeekSummary {
  const since = now - SEVEN_DAYS_MS;
  const counts = new Map<string, number>();
  let count = 0;
  let messages = 0;
  for (const s of sessions) {
    const started = s.startedAt ?? s.mtime;
    if (started < since || started > now) continue;
    count++;
    messages += s.messageCount;
    counts.set(s.projectName, (counts.get(s.projectName) ?? 0) + 1);
  }
  const topProjects = [...counts.entries()]
    .map(([name, n]) => ({ name, sessions: n }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
    .slice(0, TOP_PROJECTS);
  return { sessions: count, messages, topProjects };
}
