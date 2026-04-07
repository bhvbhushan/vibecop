#!/usr/bin/env bun
/**
 * Validation script for context optimization.
 * Tests latency, skeleton quality, and end-to-end hook flow.
 *
 * Usage: bun scripts/validate-context.ts
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ${PASS} ${name}${detail ? ` (${detail})` : ""}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

// ── Test 1: Skeleton quality ────────────────────────────────────────────────

console.log(`\n${BOLD}1. Skeleton Quality${RESET}\n`);

const { extractSkeleton } = await import("../src/context/skeleton.js");

// Test on a real file from this repo
const engineSource = readFileSync(join(import.meta.dir, "../src/engine.ts"), "utf-8");
const engineSkeleton = extractSkeleton(engineSource, "typescript");
const engineLines = engineSource.split("\n").length;
const skeletonLines = engineSkeleton.split("\n").length;
const compressionRatio = ((1 - engineSkeleton.length / engineSource.length) * 100).toFixed(1);

check("Skeleton is shorter than source", engineSkeleton.length < engineSource.length, `${compressionRatio}% reduction`);
check("Skeleton has imports", engineSkeleton.includes("import"));
check("Skeleton has function names", engineSkeleton.includes("scan") || engineSkeleton.includes("discoverFiles"));
check("Skeleton preserves exports", engineSkeleton.includes("export") || engineSkeleton.includes("scan"));
check(`Source: ${engineLines} lines → Skeleton: ${skeletonLines} lines`, skeletonLines < engineLines / 2);

// Show the skeleton for manual inspection
console.log(`\n  ${BOLD}engine.ts skeleton (${skeletonLines} lines):${RESET}`);
for (const line of engineSkeleton.split("\n").slice(0, 15)) {
  console.log(`    ${line}`);
}
if (skeletonLines > 15) console.log(`    ... (${skeletonLines - 15} more lines)`);

// Test Python skeleton
const pySource = `import os\nfrom pathlib import Path\n\ndef process(path: str) -> str:\n    with open(path) as f:\n        content = f.read()\n    lines = content.split("\\n")\n    return "\\n".join(lines)\n\nclass FileHandler:\n    def __init__(self, root: str):\n        self.root = root\n    def read(self, name: str) -> str:\n        return (Path(self.root) / name).read_text()\n`;
const pySkeleton = extractSkeleton(pySource, "python");
check("Python skeleton works", pySkeleton.includes("import os") && pySkeleton.includes("process") && pySkeleton.includes("FileHandler"));

// Token savings estimate
const { estimateTokens } = await import("../src/context/session.js");
const fullTokens = estimateTokens(engineSource);
const skeletonTokens = estimateTokens(engineSkeleton);
const savedTokens = fullTokens - skeletonTokens;
const savingsPercent = ((savedTokens / fullTokens) * 100).toFixed(1);
check(`Token savings: ${savedTokens} tokens saved (${savingsPercent}%)`, Number(savingsPercent) > 50);

// ── Test 2: Latency benchmarks ──────────────────────────────────────────────

console.log(`\n${BOLD}2. Latency Benchmarks${RESET}\n`);

const testDir = join(tmpdir(), `vibecop-validate-${Date.now()}`);
mkdirSync(testDir, { recursive: true });
mkdirSync(join(testDir, ".git"));

const contextScript = join(import.meta.dir, "../src/context.ts");
const testFile = join(testDir, "test-file.ts");
writeFileSync(testFile, engineSource);

async function timeHook(command: string, stdin: string): Promise<{ ms: number; stdout: string }> {
  const start = performance.now();
  const proc = Bun.spawn(["bun", contextScript, command], {
    stdin: new Blob([stdin]),
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const ms = performance.now() - start;
  return { ms: Math.round(ms), stdout: stdout.trim() };
}

const hookInput = JSON.stringify({
  tool_name: "Read",
  tool_input: { file_path: testFile },
  session_id: "validate-session",
});

// Cold start (first post-hook — cache miss, AST parse)
const postCold = await timeHook("--post", hookInput);
check(`Post-hook cold (cache miss): ${postCold.ms}ms`, postCold.ms < 500, "budget: <500ms");

// Pre-hook first read (no session history)
const preCold = await timeHook("--pre", hookInput);
check(`Pre-hook first read: ${preCold.ms}ms`, preCold.ms < 200, "budget: <200ms");

// Pre-hook re-read (cache hit, smart limit)
const preWarm = await timeHook("--pre", hookInput);
check(`Pre-hook re-read (cache hit): ${preWarm.ms}ms`, preWarm.ms < 200, "budget: <200ms");

// Parse the re-read response
try {
  const response = JSON.parse(preWarm.stdout);
  check("Re-read sets updatedInput.limit=30", response.updatedInput?.limit === 30);
  check("Re-read has additionalContext", typeof response.additionalContext === "string" && response.additionalContext.length > 0);
  check("additionalContext under 10K chars", (response.additionalContext?.length ?? 0) < 10000, `${response.additionalContext?.length ?? 0} chars`);
} catch {
  check("Re-read response is valid JSON", false, preWarm.stdout.slice(0, 100));
}

// Post-hook warm (cache hit — skeleton already exists)
const postWarm = await timeHook("--post", hookInput);
check(`Post-hook warm (cache hit): ${postWarm.ms}ms`, postWarm.ms < 200, "budget: <200ms");

// Run 5 iterations to get a stable P90
const latencies: number[] = [];
for (let i = 0; i < 5; i++) {
  const { ms } = await timeHook("--pre", hookInput);
  latencies.push(ms);
}
latencies.sort((a, b) => a - b);
const p90 = latencies[Math.floor(latencies.length * 0.9)];
check(`P90 pre-hook latency: ${p90}ms`, p90 < 200, "budget: <200ms");

// ── Test 3: End-to-end hook protocol ────────────────────────────────────────

console.log(`\n${BOLD}3. End-to-End Hook Protocol${RESET}\n`);

// Non-supported file → passthrough
const rustInput = JSON.stringify({
  tool_name: "Read",
  tool_input: { file_path: "/foo/bar.rs" },
  session_id: "validate-session",
});
const rustResult = await timeHook("--pre", rustInput);
check("Non-supported extension passes through", rustResult.stdout === "{}");

// Partial read (offset specified) → passthrough
const partialInput = JSON.stringify({
  tool_name: "Read",
  tool_input: { file_path: testFile, offset: 10, limit: 20 },
  session_id: "validate-session",
});
const partialResult = await timeHook("--pre", partialInput);
check("Partial read (offset>0) passes through", partialResult.stdout === "{}");

// No session_id → passthrough
const noSessionInput = JSON.stringify({
  tool_name: "Read",
  tool_input: { file_path: testFile },
});
const noSessionResult = await timeHook("--pre", noSessionInput);
check("Missing session_id passes through", noSessionResult.stdout === "{}");

// Invalid JSON → passthrough (never crash)
const proc = Bun.spawn(["bun", contextScript, "--pre"], {
  stdin: new Blob(["not json at all"]),
  cwd: testDir,
  stdout: "pipe",
  stderr: "pipe",
});
const badStdout = (await new Response(proc.stdout).text()).trim();
const badExit = await proc.exited;
check("Invalid JSON → passthrough, no crash", badStdout === "{}" && badExit === 0);

// File changed between reads → allows full read
const changedFile = join(testDir, "changing.ts");
writeFileSync(changedFile, "const v1 = 1;\n");
const changeInput1 = JSON.stringify({
  tool_name: "Read",
  tool_input: { file_path: changedFile },
  session_id: "change-session",
});
await timeHook("--post", changeInput1); // cache v1
writeFileSync(changedFile, "const v2 = 2;\nexport function changed() { return v2; }\n");
const changeResult = await timeHook("--pre", changeInput1);
const changeParsed = JSON.parse(changeResult.stdout);
check("Changed file: no limit override", changeParsed.updatedInput === undefined);
check("Changed file: notes the change", changeParsed.additionalContext?.includes("changed"));

// Stats command
const statsProc = Bun.spawn(["bun", contextScript, "stats"], {
  cwd: testDir,
  stdout: "pipe",
  stderr: "pipe",
});
const statsOut = await new Response(statsProc.stdout).text();
await statsProc.exited;
check("Stats command shows data", statsOut.includes("Sessions tracked") || statsOut.includes("Total reads"));

// ── Cleanup ─────────────────────────────────────────────────────────────────

try { rmSync(testDir, { recursive: true }); } catch {}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}═══════════════════════════════════════${RESET}`);
console.log(`${BOLD}Results: ${passed} passed, ${failed} failed${RESET}`);

if (failed > 0) {
  console.log(`\n${FAIL} NOT READY TO SHIP — fix failures above`);
  process.exit(1);
} else {
  console.log(`\n${PASS} ALL CHECKS PASSED — ready for manual A/B testing`);
  console.log(`\nNext: enable in a real session and compare token usage:`);
  console.log(`  vibecop init --context`);
  console.log(`  # work for 15 min, then:`);
  console.log(`  vibecop context stats`);
}
console.log();
