#!/usr/bin/env bun
/**
 * Empirical test for Claude Code PreToolUse hook behavior with Read tool dedup.
 *
 * Verifies:
 *  1. Whether PreToolUse hooks fire BEFORE built-in read deduplication
 *  2. The exact JSON format of hook stdin for Read tool calls
 *  3. Whether updatedInput (limit) and additionalContext work as expected
 *
 * Usage:
 *   As hook:  Configured via .claude/settings.json PreToolUse matcher "Read"
 *   Reset:    bun scripts/test-hook-dedup.ts --reset
 *   Stats:    bun scripts/test-hook-dedup.ts --stats
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const LOG_FILE = "/tmp/vibecop-hook-test.jsonl";
const READS_FILE = "/tmp/vibecop-hook-reads.json";

// ── CLI flags ───────────────────────────────────────────────────────────────

if (process.argv.includes("--reset")) {
  for (const f of [LOG_FILE, READS_FILE]) {
    if (existsSync(f)) unlinkSync(f);
  }
  console.log("Cleared tracking and log files.");
  process.exit(0);
}

if (process.argv.includes("--stats")) {
  if (!existsSync(LOG_FILE)) {
    console.log("No log file found. Nothing recorded yet.");
    process.exit(0);
  }
  const lines = readFileSync(LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
  const perFile: Record<string, { total: number; rereads: number }> = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const path = entry.tool_input?.file_path ?? "<unknown>";
      perFile[path] ??= { total: 0, rereads: 0 };
      perFile[path].total++;
      if (entry.is_reread) perFile[path].rereads++;
    } catch {}
  }
  console.log(`Total invocations: ${lines.length}`);
  for (const [path, counts] of Object.entries(perFile)) {
    console.log(`  ${path}  →  ${counts.total} reads (${counts.rereads} re-reads)`);
  }
  process.exit(0);
}

// ── Hook entrypoint ─────────────────────────────────────────────────────────

try {
  const stdin = readFileSync("/dev/stdin", "utf-8");
  const hook = JSON.parse(stdin) as {
    tool_name: string;
    tool_input: { file_path?: string; offset?: number; limit?: number };
    session_id?: string;
  };

  // Load previously-seen reads
  let seen: Record<string, number> = {};
  if (existsSync(READS_FILE)) {
    try { seen = JSON.parse(readFileSync(READS_FILE, "utf-8")); } catch {}
  }

  const filePath = hook.tool_input?.file_path ?? "";
  const isReread = filePath in seen;

  // Log every invocation
  appendFileSync(
    LOG_FILE,
    JSON.stringify({
      ts: new Date().toISOString(),
      tool_name: hook.tool_name,
      tool_input: hook.tool_input,
      session_id: hook.session_id,
      is_reread: isReread,
      seen_count: seen[filePath] ?? 0,
    }) + "\n",
  );

  // Update tracking
  seen[filePath] = (seen[filePath] ?? 0) + 1;
  writeFileSync(READS_FILE, JSON.stringify(seen, null, 2));

  if (!isReread) {
    // First read — passthrough
    console.log("{}");
  } else {
    // Re-read — test updatedInput + additionalContext
    console.log(JSON.stringify({
      updatedInput: { file_path: filePath, limit: 30 },
      additionalContext: `[vibecop-test] Re-read #${seen[filePath]} of ${filePath}. Skeleton would go here.`,
    }));
  }
} catch {
  // Never block the agent
  console.log("{}");
}
