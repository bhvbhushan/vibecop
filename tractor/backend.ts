#!/usr/bin/env bun
/**
 * Proof-of-concept: Tractor as a backend for VibeCop
 *
 * Demonstrates how Tractor's `tractor check --rules` can replace most of
 * VibeCop's 22 hand-coded AST detectors with declarative XPath rules.
 *
 * Usage:
 *   bun tractor/backend.ts [scan-path]
 *   bun tractor/backend.ts "src/**/*.ts" --format json
 *   bun tractor/backend.ts "src/**/*.ts" --format gcc
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types matching VibeCop's Finding interface
// ---------------------------------------------------------------------------

interface Finding {
  detectorId: string;
  message: string;
  severity: "error" | "warning" | "info";
  file: string;
  line: number;
  column: number;
  suggestion?: string;
}

interface TractorResult {
  file: string;
  results: Array<{
    reason: string;
    severity: string;
    source?: string;
    lines?: string[];
    line: number;
    column: number;
    rule_id?: string;
  }>;
}

interface TractorReport {
  success: boolean;
  totals: { results: number; files: number; errors?: number; warnings?: number };
  group?: string;
  results: TractorResult[];
}

// ---------------------------------------------------------------------------
// Rule metadata: suggestions for each tractor rule
// ---------------------------------------------------------------------------

const SUGGESTIONS: Record<string, string> = {
  "debug-console-in-prod": "Remove debug logging or replace with a structured logger",
  "double-type-assertion": "Fix the underlying type mismatch instead of using double assertion",
  "empty-catch-block": "Add error handling, re-throw the error, or add a comment explaining why",
  "catch-block-log-only": "Add proper error handling: re-throw, return a fallback value, or propagate",
  "todo-in-production": "Address the TODO or create a tracked issue and reference it",
  "god-function-params": "Use an options object pattern to reduce parameter count",
  "god-lambda-params": "Use an options object pattern to reduce parameter count",
  "sql-injection-template": "Use parameterized queries: db.query('SELECT * WHERE id = $1', [userId])",
  "sql-injection-concat": "Use parameterized queries instead of string concatenation",
  "eval-usage": "Use JSON.parse() for data, or refactor to avoid dynamic code execution",
  "new-function-usage": "Refactor to use static function definitions",
  "tls-verification-disabled": "Remove rejectUnauthorized: false to enable TLS certificate verification",
  "token-in-localstorage": "Use httpOnly cookies instead of localStorage for auth tokens",
  "n-plus-one-for-loop": "Batch queries with Promise.all or use WHERE IN clause",
  "n-plus-one-async-map": "Batch operations or use Promise.all instead of awaiting in .map()",
};

// ---------------------------------------------------------------------------
// Core: run tractor and parse output
// ---------------------------------------------------------------------------

function findRulesFile(): string {
  const candidates = [
    resolve("tractor/rules.yaml"),
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "rules.yaml"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error("Cannot find tractor/rules.yaml. Run from the vibecop project root.");
}

function runTractor(fileGlob: string): TractorReport {
  const rulesFile = findRulesFile();

  const cmd = [
    "tractor",
    "check",
    JSON.stringify(fileGlob),
    "--rules", JSON.stringify(rulesFile),
    "-f", "json",
    "-v", "reason,severity,file,line,column",
  ].join(" ");

  const opts: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
  };

  let stdout: string;
  try {
    stdout = execSync(cmd, opts);
  } catch (err: unknown) {
    // Exit code 1 = findings found (not an error)
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    if (execErr.status === 1 && execErr.stdout) {
      stdout = execErr.stdout;
    } else {
      const stderr = execErr.stderr || "";
      throw new Error(`tractor failed (exit ${execErr.status}): ${stderr}`);
    }
  }

  return JSON.parse(stdout) as TractorReport;
}

// ---------------------------------------------------------------------------
// Map tractor output → VibeCop findings
// ---------------------------------------------------------------------------

function mapToFindings(report: TractorReport): Finding[] {
  const findings: Finding[] = [];

  for (const fileResult of report.results) {
    if (!fileResult.file) continue;

    for (const result of fileResult.results) {
      const ruleId = result.rule_id || "unknown";
      findings.push({
        detectorId: ruleId,
        message: result.reason,
        severity: mapSeverity(result.severity),
        file: fileResult.file,
        line: result.line,
        column: result.column,
        suggestion: SUGGESTIONS[ruleId],
      });
    }
  }

  return findings;
}

function mapSeverity(s: string): "error" | "warning" | "info" {
  if (s === "error") return "error";
  if (s === "warning") return "warning";
  return "info";
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

function formatText(findings: Finding[]): string {
  if (findings.length === 0) return "No findings.\n";

  const lines: string[] = [];
  for (const f of findings) {
    const icon = f.severity === "error" ? "E" : f.severity === "warning" ? "W" : "I";
    lines.push(`[${icon}] ${f.file}:${f.line}:${f.column} [${f.detectorId}]`);
    lines.push(`    ${f.message}`);
    if (f.suggestion) lines.push(`    -> ${f.suggestion}`);
    lines.push("");
  }

  const errors = findings.filter(f => f.severity === "error").length;
  const warnings = findings.filter(f => f.severity === "warning").length;
  const info = findings.filter(f => f.severity === "info").length;
  lines.push(`${findings.length} findings: ${errors} errors, ${warnings} warnings, ${info} info`);
  return lines.join("\n");
}

function formatJson(findings: Finding[]): string {
  return JSON.stringify({
    findings,
    summary: {
      total: findings.length,
      errors: findings.filter(f => f.severity === "error").length,
      warnings: findings.filter(f => f.severity === "warning").length,
      info: findings.filter(f => f.severity === "info").length,
    },
  }, null, 2);
}

function formatGcc(findings: Finding[]): string {
  return findings
    .map(f => `${f.file}:${f.line}:${f.column}: ${f.severity}: ${f.message} [${f.detectorId}]`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const fileGlob = args.find(a => !a.startsWith("--") && !a.startsWith("-f")) || "src/**/*.ts";
  const formatIdx = args.indexOf("--format") !== -1 ? args.indexOf("--format") : args.indexOf("-f");
  const format = formatIdx !== -1 ? args[formatIdx + 1] : "text";

  console.error(`[tractor-backend] Scanning ${fileGlob}...`);

  const report = runTractor(fileGlob);
  const findings = mapToFindings(report);

  switch (format) {
    case "json":
      console.log(formatJson(findings));
      break;
    case "gcc":
      console.log(formatGcc(findings));
      break;
    default:
      console.log(formatText(findings));
  }

  process.exit(findings.some(f => f.severity === "error") ? 1 : 0);
}

main();
