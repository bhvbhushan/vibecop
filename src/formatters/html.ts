import type { Finding, ScanResult } from "../types.js";

/**
 * Escape HTML special characters to prevent XSS in output.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Get a CSS color class name for a severity level.
 */
function severityClass(severity: Finding["severity"]): string {
  switch (severity) {
    case "error":
      return "severity-error";
    case "warning":
      return "severity-warning";
    case "info":
      return "severity-info";
  }
}

/**
 * Format scan results as a self-contained HTML report.
 *
 * Produces a single HTML string with inline CSS, no external dependencies.
 * Findings are grouped by file with a summary header and footer.
 */
export function formatHtml(result: ScanResult): string {
  const totalFindings = result.findings.length;
  const errorCount = result.findings.filter(
    (f) => f.severity === "error",
  ).length;
  const warningCount = result.findings.filter(
    (f) => f.severity === "warning",
  ).length;
  const infoCount = result.findings.filter(
    (f) => f.severity === "info",
  ).length;

  // Group findings by file
  const byFile = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const existing = byFile.get(finding.file);
    if (existing) {
      existing.push(finding);
    } else {
      byFile.set(finding.file, [finding]);
    }
  }

  // Build file sections
  const fileSections: string[] = [];
  for (const [file, findings] of byFile) {
    const rows = findings
      .map(
        (f) =>
          `        <tr>
          <td class="col-line"><code>${f.line}:${f.column}</code></td>
          <td class="col-severity"><span class="badge ${severityClass(f.severity)}">${escapeHtml(f.severity)}</span></td>
          <td class="col-rule"><code>${escapeHtml(f.detectorId)}</code></td>
          <td class="col-message">${escapeHtml(f.message)}</td>
        </tr>`,
      )
      .join("\n");

    fileSections.push(`    <div class="file-group">
      <h2 class="file-heading"><code>${escapeHtml(file)}</code> <span class="file-count">(${findings.length})</span></h2>
      <table class="findings-table">
        <thead>
          <tr>
            <th>Line</th>
            <th>Severity</th>
            <th>Rule</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`);
  }

  const filesContent =
    fileSections.length > 0
      ? fileSections.join("\n")
      : '    <p class="no-findings">No problems found.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>vibecop Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #333; line-height: 1.6; }
    header { background: #1a1a2e; color: #fff; padding: 24px 32px; }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    header p { color: #a0a0b8; font-size: 0.9rem; margin-top: 4px; }
    .summary { display: flex; gap: 24px; padding: 20px 32px; background: #f8f9fa; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
    .summary-item { text-align: center; }
    .summary-item .count { font-size: 1.8rem; font-weight: 700; }
    .summary-item .label { font-size: 0.8rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    .count-total { color: #333; }
    .count-error { color: #d32f2f; }
    .count-warning { color: #f57c00; }
    .count-info { color: #1976d2; }
    .count-files { color: #555; }
    main { padding: 24px 32px; max-width: 1200px; }
    .file-group { margin-bottom: 32px; }
    .file-heading { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
    .file-heading code { font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace; background: #f0f0f0; padding: 2px 8px; border-radius: 3px; }
    .file-count { color: #888; font-weight: 400; font-size: 0.85rem; }
    .findings-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .findings-table th { text-align: left; padding: 8px 12px; background: #f5f5f5; border-bottom: 2px solid #ddd; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: #555; }
    .findings-table td { padding: 8px 12px; border-bottom: 1px solid #eee; vertical-align: top; }
    .findings-table tr:hover td { background: #fafafa; }
    .col-line code { font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace; font-size: 0.85rem; color: #555; }
    .col-rule code { font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace; font-size: 0.85rem; color: #555; }
    .col-severity { white-space: nowrap; }
    .col-message { max-width: 500px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
    .severity-error { background: #ffebee; color: #c62828; }
    .severity-warning { background: #fff3e0; color: #e65100; }
    .severity-info { background: #e3f2fd; color: #1565c0; }
    .no-findings { color: #388e3c; font-weight: 600; padding: 32px 0; }
    footer { padding: 20px 32px; border-top: 1px solid #e0e0e0; color: #999; font-size: 0.8rem; margin-top: 32px; }
  </style>
</head>
<body>
  <header>
    <h1>vibecop Report</h1>
    <p>AI code quality analysis results</p>
  </header>
  <div class="summary">
    <div class="summary-item">
      <div class="count count-total">${totalFindings}</div>
      <div class="label">Total Findings</div>
    </div>
    <div class="summary-item">
      <div class="count count-error">${errorCount}</div>
      <div class="label">Errors</div>
    </div>
    <div class="summary-item">
      <div class="count count-warning">${warningCount}</div>
      <div class="label">Warnings</div>
    </div>
    <div class="summary-item">
      <div class="count count-info">${infoCount}</div>
      <div class="label">Info</div>
    </div>
    <div class="summary-item">
      <div class="count count-files">${result.filesScanned}</div>
      <div class="label">Files Scanned</div>
    </div>
  </div>
  <main>
${filesContent}
  </main>
  <footer>Generated by vibecop v0.1.0</footer>
</body>
</html>`;
}
