import type { ScanResult } from "../types.js";

/**
 * Format scan results for AI coding agent consumption.
 *
 * One finding per line, no color, no decoration, no summary.
 * Format: {file}:{line}:{col} {severity} {detectorId}: {message}[. {suggestion}]
 *
 * Returns empty string when there are no findings — agents parse stdout
 * and empty output means clean.
 */
export function formatAgent(result: ScanResult): string {
  if (result.findings.length === 0) {
    return "";
  }

  return result.findings
    .map((f) => {
      const location = `${f.file}:${f.line}:${f.column}`;
      const suffix = f.suggestion ? `. ${f.suggestion}` : "";
      return `${location} ${f.severity} ${f.detectorId}: ${f.message}${suffix}`;
    })
    .join("\n");
}
