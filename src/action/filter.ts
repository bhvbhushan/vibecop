import type { Finding } from "../types.js";
import type { FileDiff } from "./diff.js";

export interface FilteredFindings {
  /** Findings that can be posted as inline review comments */
  inline: Array<Finding & { diffPosition: number }>;
  /** Findings in changed files but not on changed lines */
  summaryOnly: Finding[];
}

/** GitHub enforces a maximum of 50 review comments per request */
const MAX_INLINE_COMMENTS = 50;

const SEVERITY_ORDER: Record<string, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * Filter scan findings into inline-eligible (can be posted as PR review
 * comments on changed lines) vs summary-only (included in the review
 * body but not attached to a specific diff line).
 */
export function filterFindings(
  findings: Finding[],
  fileDiffs: Map<string, FileDiff>,
  severityThreshold: "error" | "warning" | "info",
): FilteredFindings {
  const thresholdValue = SEVERITY_ORDER[severityThreshold];
  const inline: FilteredFindings["inline"] = [];
  const summaryOnly: Finding[] = [];

  for (const finding of findings) {
    // Skip findings below severity threshold
    const findingSeverity = SEVERITY_ORDER[finding.severity] ?? 0;
    if (findingSeverity < thresholdValue) continue;

    const fileDiff = fileDiffs.get(finding.file);
    if (!fileDiff) {
      // File not in diff at all — summary only
      summaryOnly.push(finding);
      continue;
    }

    const isAdded = fileDiff.addedLines.has(finding.line);
    const position = fileDiff.lineToPosition.get(finding.line);

    if (isAdded && position !== undefined) {
      inline.push({ ...finding, diffPosition: position });
    } else {
      summaryOnly.push(finding);
    }
  }

  // Sort inline findings by file path, then line number
  inline.sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    return a.line - b.line;
  });

  // Cap inline at MAX_INLINE_COMMENTS; overflow goes to summaryOnly
  if (inline.length > MAX_INLINE_COMMENTS) {
    const overflow = inline.splice(MAX_INLINE_COMMENTS);
    for (const item of overflow) {
      // Strip the diffPosition before pushing to summaryOnly
      const { diffPosition: _, ...finding } = item;
      summaryOnly.push(finding);
    }
  }

  return { inline, summaryOnly };
}
