import type { Database } from "bun:sqlite";
import { getAllStats, getSessionStats, type SessionStats } from "./cache.js";

export function formatStats(stats: SessionStats[]): string {
  if (stats.length === 0) return "No context optimization data recorded yet.\nRun `vibecop context benchmark` to see projected savings for this project.";

  const lines: string[] = [];

  let totalReads = 0;
  let totalHits = 0;
  let totalSaved = 0;

  for (const s of stats) {
    totalReads += s.totalReads;
    totalHits += s.cacheHits;
    totalSaved += s.tokensSaved;
  }

  const hitRate = totalReads > 0 ? ((totalHits / totalReads) * 100).toFixed(1) : "0.0";

  lines.push("vibecop context optimization");
  lines.push("════════════════════════════");
  lines.push("");
  lines.push(`Sessions:     ${stats.length}`);
  lines.push(`Total reads:  ${totalReads}`);
  lines.push(`Cache hits:   ${totalHits} (${hitRate}% of reads)`);
  lines.push(`Tokens saved: ~${totalSaved.toLocaleString()}`);

  if (totalSaved > 0 && totalHits > 0) {
    const avgSavedPerHit = Math.round(totalSaved / totalHits);
    lines.push(`Avg savings:  ~${avgSavedPerHit.toLocaleString()} tokens per re-read`);
  }

  lines.push("");

  if (stats.length <= 10 && stats.length > 0) {
    lines.push("Per-session:");
    for (const s of stats) {
      const rate = s.totalReads > 0
        ? ((s.cacheHits / s.totalReads) * 100).toFixed(0)
        : "0";
      lines.push(
        `  ${s.sessionId.slice(0, 8)}…  ${s.totalReads} reads, ${s.cacheHits} hits (${rate}%), ~${s.tokensSaved.toLocaleString()} saved`,
      );
    }
  }

  return lines.join("\n");
}

export function printStats(db: Database, sessionId?: string): void {
  if (sessionId) {
    const stats = getSessionStats(db, sessionId);
    if (stats) {
      console.log(formatStats([stats]));
    } else {
      console.log(`No stats found for session ${sessionId}`);
    }
  } else {
    console.log(formatStats(getAllStats(db)));
  }
}
