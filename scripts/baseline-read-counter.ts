#!/usr/bin/env bun
/**
 * Baseline Read counter — logs read activity WITHOUT optimizing anything.
 * Use this as a PreToolUse Read hook in a session WITHOUT context optimization
 * to establish a baseline for comparison.
 *
 * Setup:  Add to .claude/settings.json PreToolUse Read hook
 * Stats:  bun scripts/baseline-read-counter.ts --stats
 * Reset:  bun scripts/baseline-read-counter.ts --reset
 *
 * Always passes through (outputs {}) — zero impact on the session.
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { extname } from "node:path";

const LOG = "/tmp/vibecop-baseline-reads.jsonl";
const SUPPORTED = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);

if (process.argv.includes("--reset")) {
  if (existsSync(LOG)) unlinkSync(LOG);
  console.log("Baseline log cleared.");
  process.exit(0);
}

if (process.argv.includes("--stats")) {
  if (!existsSync(LOG)) {
    console.log("No baseline data. Run a session with the baseline hook first.");
    process.exit(0);
  }

  const lines = readFileSync(LOG, "utf-8").trim().split("\n").filter(Boolean);
  const perFile: Record<string, number> = {};
  let totalReads = 0;
  let supportedReads = 0;
  let reReads = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const path = entry.path ?? "<unknown>";
      perFile[path] = (perFile[path] ?? 0) + 1;
      totalReads++;
      if (entry.supported) supportedReads++;
    } catch {}
  }

  for (const count of Object.values(perFile)) {
    if (count > 1) reReads += count - 1;
  }

  const uniqueFiles = Object.keys(perFile).length;
  const reReadPercent = totalReads > 0 ? ((reReads / totalReads) * 100).toFixed(1) : "0";

  // Estimate token savings if context optimization were enabled
  // Avg file ~300 lines, ~5100 tokens. Skeleton ~900 tokens. Savings ~4200 per re-read.
  const estimatedSavings = reReads * 4200;

  console.log("Baseline Session Stats (no optimization)");
  console.log("=========================================");
  console.log(`Total Read calls:       ${totalReads}`);
  console.log(`Unique files:           ${uniqueFiles}`);
  console.log(`Supported files:        ${supportedReads} (${SUPPORTED.size} extensions)`);
  console.log(`Re-reads:               ${reReads} (${reReadPercent}% of total)`);
  console.log(`Avg reads per file:     ${(totalReads / Math.max(uniqueFiles, 1)).toFixed(1)}`);
  console.log();
  console.log(`Estimated token savings with context optimization:`);
  console.log(`  ~${estimatedSavings.toLocaleString()} tokens (${reReads} re-reads x ~4,200 tokens each)`);
  console.log();

  // Show top re-read files
  const sorted = Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (sorted.length > 0 && sorted[0][1] > 1) {
    console.log("Most re-read files:");
    for (const [path, count] of sorted) {
      if (count <= 1) break;
      console.log(`  ${count}x  ${path}`);
    }
  }

  process.exit(0);
}

// Hook mode — log and passthrough
try {
  const stdin = readFileSync("/dev/stdin", "utf-8");
  const input = JSON.parse(stdin);
  const path = input.tool_input?.file_path ?? "";
  const ext = extname(path);

  appendFileSync(LOG, JSON.stringify({
    ts: new Date().toISOString(),
    path,
    ext,
    supported: SUPPORTED.has(ext),
    session_id: input.session_id ?? null,
  }) + "\n");
} catch {}

// Always passthrough
console.log("{}");
