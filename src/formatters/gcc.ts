import type { ScanResult } from "../types.js";

/**
 * Format scan results in GCC-compatible diagnostic format.
 * Each finding: file:line:col: severity: message [detector-id]
 */
export function formatGcc(result: ScanResult): string {
  const lines: string[] = [];

  for (const finding of result.findings) {
    lines.push(
      `${finding.file}:${finding.line}:${finding.column}: ${finding.severity}: ${finding.message} [${finding.detectorId}]`,
    );
  }

  const fileCount = new Set(result.findings.map((f) => f.file)).size;
  const n = result.findings.length;
  if (n === 0) {
    lines.push("0 findings");
  } else {
    lines.push(
      `${n} finding${n !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""}`,
    );
  }

  return lines.join("\n");
}
