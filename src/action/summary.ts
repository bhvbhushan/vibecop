import type { Finding, ScanResult } from "../types.js";

/** Map severity to emoji for markdown display */
function severityEmoji(severity: Finding["severity"]): string {
  switch (severity) {
    case "error":
      return ":x:";
    case "warning":
      return ":warning:";
    case "info":
      return ":information_source:";
  }
}

/**
 * Build the PR review body markdown summarizing scan results.
 *
 * Includes a metrics table, optional "additional findings" table for
 * findings on unchanged lines, and optional scan errors section.
 */
export function buildActionSummary(
  result: ScanResult,
  inlineCount: number,
  summaryOnlyFindings: Finding[],
  scanTimeMs: number,
): string {
  const total = result.findings.length;
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter(
    (f) => f.severity === "warning",
  ).length;
  const info = result.findings.filter((f) => f.severity === "info").length;

  const lines: string[] = [];

  lines.push("## vibecop PR Scan Results");
  lines.push("");

  if (total === 0) {
    lines.push(
      "No issues found. All scanned files look clean.",
    );
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Files scanned | ${result.filesScanned} |`);
    lines.push(`| Findings | 0 |`);
    lines.push(`| Scan time | ${scanTimeMs}ms |`);
    lines.push("");
  } else {
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Files scanned | ${result.filesScanned} |`);
    lines.push(
      `| Findings | ${total} (${errors} errors, ${warnings} warnings, ${info} info) |`,
    );
    lines.push(`| Inline comments | ${inlineCount} |`);
    lines.push(`| Scan time | ${scanTimeMs}ms |`);
    lines.push("");
  }

  if (summaryOnlyFindings.length > 0) {
    lines.push("### Additional findings (not on changed lines)");
    lines.push("");
    lines.push(
      "These findings are in changed files but on lines that were not modified in this PR:",
    );
    lines.push("");
    lines.push("| File | Line | Severity | Rule | Message |");
    lines.push("|------|------|----------|------|---------|");

    for (const f of summaryOnlyFindings) {
      lines.push(
        `| ${f.file} | ${f.line} | ${severityEmoji(f.severity)} | ${f.detectorId} | ${f.message} |`,
      );
    }

    lines.push("");
  }

  if (result.errors.length > 0) {
    lines.push("### Scan Errors");
    lines.push("");

    for (const err of result.errors) {
      const prefix = err.detectorId
        ? `${err.file} [${err.detectorId}]`
        : err.file;
      lines.push(`- **${prefix}**: ${err.message}`);
    }

    lines.push("");
  }

  lines.push("---");
  lines.push(
    '<sub>Scanned by <a href="https://github.com/bhvbhushan/vibecop">vibecop</a></sub>',
  );

  return lines.join("\n");
}
