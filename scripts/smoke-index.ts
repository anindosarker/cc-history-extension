/**
 * Smoke test the indexer and session parser against the real ~/.claude/projects folder.
 * Prints counts and timings only; never prints message contents.
 */
import * as os from "node:os";
import * as path from "node:path";
import { groupByProject, scanProjects } from "../src/extension/indexScan";
import { parseSessionFile } from "../src/extension/parser";
import { extractFileChanges } from "../src/extension/diff";

async function main(): Promise<void> {
  const dir = process.argv[2] ?? path.join(os.homedir(), ".claude", "projects");
  const t0 = performance.now();
  const { sessions, scanned } = await scanProjects(dir, new Map());
  const indexMs = performance.now() - t0;
  const projects = groupByProject(sessions);
  const totalBytes = sessions.reduce((n, s) => n + s.size, 0);

  console.log(`projects dir:   ${dir}`);
  console.log(`projects:       ${projects.length}`);
  console.log(`sessions:       ${sessions.length} (${scanned} scanned)`);
  console.log(`total size:     ${(totalBytes / 1e6).toFixed(1)} MB`);
  console.log(`index time:     ${(indexMs / 1000).toFixed(2)} s`);
  console.log(`sample titles:`);
  for (const s of sessions.slice().sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, 5)) {
    console.log(`  [${s.titleSource}] ${s.title.slice(0, 70)}  (${s.projectName}, ${s.messageCount} msgs)`);
  }

  const largest = sessions.reduce((a, b) => (b.size > a.size ? b : a), sessions[0]);
  if (!largest) return;
  const t1 = performance.now();
  const parsed = await parseSessionFile(largest.filePath);
  const parseMs = performance.now() - t1;
  const t2 = performance.now();
  const files = extractFileChanges(parsed.turns);
  const diffMs = performance.now() - t2;
  const payload = JSON.stringify(parsed.turns).length;
  console.log(`largest file:   ${(largest.size / 1e6).toFixed(1)} MB, ${parsed.turns.length} turns`);
  console.log(`parse time:     ${(parseMs / 1000).toFixed(2)} s`);
  console.log(`files changed:  ${files.length} (${files.filter((f) => f.partial).length} partial), diff ${diffMs.toFixed(0)} ms`);
  console.log(`turn payload:   ${(payload / 1e6).toFixed(1)} MB serialized`);
  console.log(`heap used:      ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
