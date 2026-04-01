import type { Finding, ScanResult } from "../types.js";

/** ANSI escape codes for color output */
const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
} as const;

/** No-op colors when color is disabled */
const NO_COLORS: Record<keyof typeof COLORS, string> = {
  red: "",
  yellow: "",
  blue: "",
  dim: "",
  reset: "",
  bold: "",
};

/** Determine if color output should be used */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (typeof process.stdout.isTTY === "boolean") return process.stdout.isTTY;
  return false;
}

/** Get the color string for a severity level */
function severityColor(
  severity: Finding["severity"],
  c: typeof COLORS | typeof NO_COLORS,
): string {
  switch (severity) {
    case "error":
      return c.red;
    case "warning":
      return c.yellow;
    case "info":
      return c.blue;
  }
}

export interface TextFormatOptions {
  groupBy?: "file" | "rule";
}

type ColorSet = typeof COLORS | typeof NO_COLORS;

/** Render findings grouped by file (default) */
function renderByFile(
  result: ScanResult,
  c: ColorSet,
  lines: string[],
): void {
  const byFile = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const existing = byFile.get(finding.file);
    if (existing) {
      existing.push(finding);
    } else {
      byFile.set(finding.file, [finding]);
    }
  }

  let maxLocLen = 0;
  let maxSevLen = 0;
  for (const findings of byFile.values()) {
    for (const f of findings) {
      const loc = `${f.line}:${f.column}`;
      if (loc.length > maxLocLen) maxLocLen = loc.length;
      if (f.severity.length > maxSevLen) maxSevLen = f.severity.length;
    }
  }

  for (const [file, findings] of byFile) {
    lines.push(`${c.bold}${file}${c.reset}`);
    for (const f of findings) {
      const loc = `${f.line}:${f.column}`;
      const sevColor = severityColor(f.severity, c);
      const paddedLoc = loc.padEnd(maxLocLen);
      const paddedSev = f.severity.padEnd(maxSevLen);
      lines.push(
        `  ${c.dim}${paddedLoc}${c.reset}  ${sevColor}${paddedSev}${c.reset}  ${f.message}  ${c.dim}${f.detectorId}${c.reset}`,
      );
    }
    lines.push("");
  }
}

/** Render findings grouped by rule/detector */
function renderByRule(
  result: ScanResult,
  c: ColorSet,
  lines: string[],
): void {
  const byRule = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const existing = byRule.get(finding.detectorId);
    if (existing) {
      existing.push(finding);
    } else {
      byRule.set(finding.detectorId, [finding]);
    }
  }

  for (const [rule, findings] of byRule) {
    const sevColor = severityColor(findings[0].severity, c);
    const count = findings.length;
    lines.push(
      `${c.bold}${rule}${c.reset} ${c.dim}(${count} ${findings[0].severity}${count !== 1 ? "s" : ""})${c.reset}`,
    );

    let maxFileLocLen = 0;
    for (const f of findings) {
      const fileLoc = `${f.file}:${f.line}:${f.column}`;
      if (fileLoc.length > maxFileLocLen) maxFileLocLen = fileLoc.length;
    }

    for (const f of findings) {
      const fileLoc = `${f.file}:${f.line}:${f.column}`;
      const padded = fileLoc.padEnd(maxFileLocLen);
      lines.push(
        `  ${sevColor}${padded}${c.reset}  ${f.message}`,
      );
    }
    lines.push("");
  }
}

/**
 * Format scan results as stylish terminal output.
 *
 * Groups findings by file (default) or by rule (--group-by rule).
 * Adds color when stdout is a TTY (unless NO_COLOR is set).
 * Shows a summary line at the bottom with total counts.
 */
export function formatText(
  result: ScanResult,
  options?: TextFormatOptions,
): string {
  const c = shouldUseColor() ? COLORS : NO_COLORS;
  const lines: string[] = [];
  const groupBy = options?.groupBy ?? "file";

  if (groupBy === "rule") {
    renderByRule(result, c, lines);
  } else {
    renderByFile(result, c, lines);
  }

  // Show scan errors
  if (result.errors.length > 0) {
    for (const err of result.errors) {
      const prefix = err.detectorId
        ? `${err.file} [${err.detectorId}]`
        : err.file;
      lines.push(`${c.red}Error: ${prefix}: ${err.message}${c.reset}`);
    }
    if (result.errors.length > 0 && result.findings.length > 0) {
      lines.push("");
    }
  }

  // Summary line
  const total = result.findings.length;
  if (total === 0 && result.errors.length === 0) {
    lines.push(`${c.bold}\u2714 No problems found${c.reset}`);
  } else if (total > 0) {
    const errors = result.findings.filter((f) => f.severity === "error").length;
    const warnings = result.findings.filter(
      (f) => f.severity === "warning",
    ).length;
    const info = result.findings.filter((f) => f.severity === "info").length;

    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error${errors !== 1 ? "s" : ""}`);
    if (warnings > 0)
      parts.push(`${warnings} warning${warnings !== 1 ? "s" : ""}`);
    if (info > 0) parts.push(`${info} info`);

    lines.push(
      `${c.red}${c.bold}\u2716 ${total} problem${total !== 1 ? "s" : ""} (${parts.join(", ")})${c.reset}`,
    );
  }

  // Timing info (shown by --verbose)
  if (result.timing) {
    lines.push("");
    lines.push(`${c.dim}Scan completed in ${result.timing.totalMs.toFixed(0)}ms${c.reset}`);
    const detectors = Object.entries(result.timing.perDetector).sort(
      ([, a], [, b]) => b - a,
    );
    for (const [id, ms] of detectors) {
      lines.push(`${c.dim}  ${id}: ${ms.toFixed(0)}ms${c.reset}`);
    }
  }

  return lines.join("\n");
}
