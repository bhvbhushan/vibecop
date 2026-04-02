import { appendFileSync } from "node:fs";
import type { Finding, ScanResult } from "../types.js";

/** Map finding severity to GitHub Actions annotation level */
function ghLevel(severity: Finding["severity"]): "error" | "warning" | "notice" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "notice";
  }
}

/** Escape special characters for workflow command values */
function escapeProperty(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

/** Escape special characters for workflow command data */
function escapeData(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/**
 * Build the GITHUB_STEP_SUMMARY markdown content.
 */
function buildSummaryMarkdown(result: ScanResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;
  const warnings = result.findings.filter((f) => f.severity === "warning").length;
  const info = result.findings.filter((f) => f.severity === "info").length;

  const lines: string[] = [];

  lines.push("## vibecop Scan Results");
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Error | ${errors} |`);
  lines.push(`| Warning | ${warnings} |`);
  lines.push(`| Info | ${info} |`);
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("### Findings");
    lines.push("");
    lines.push("| File | Line | Severity | Rule | Message |");
    lines.push("|------|------|----------|------|---------|");

    for (const f of result.findings) {
      lines.push(
        `| ${f.file} | ${f.line} | ${f.severity} | ${f.detectorId} | ${f.message} |`,
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

  return lines.join("\n");
}

/**
 * Format scan results as GitHub Actions workflow commands.
 *
 * Produces `::error`, `::warning`, or `::notice` annotation lines
 * for each finding, plus `::warning` for scan errors.
 *
 * If the `GITHUB_STEP_SUMMARY` environment variable is set, appends
 * a markdown summary table to that file.
 */
export function formatGithub(result: ScanResult): string {
  const lines: string[] = [];

  for (const finding of result.findings) {
    const level = ghLevel(finding.severity);
    const file = escapeProperty(finding.file);
    const title = escapeProperty(finding.detectorId);
    const message = escapeData(finding.message);

    lines.push(
      `::${level} file=${file},line=${finding.line},col=${finding.column},title=${title}::${message}`,
    );
  }

  // Scan errors become ::warning annotations
  for (const err of result.errors) {
    const file = escapeProperty(err.file);
    const title = err.detectorId
      ? escapeProperty(`scan-error:${err.detectorId}`)
      : escapeProperty("scan-error");
    const message = escapeData(err.message);

    lines.push(`::warning file=${file},title=${title}::${message}`);
  }

  // Write GITHUB_STEP_SUMMARY if set
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const markdown = buildSummaryMarkdown(result);
    appendFileSync(summaryPath, markdown);
  }

  return lines.join("\n");
}
