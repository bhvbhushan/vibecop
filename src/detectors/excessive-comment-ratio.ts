import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

/**
 * Detects files where comments dominate the code.
 * This is a sign of AI-generated verbose commenting.
 *
 * Logic:
 * 1. Count comment lines (single-line and block comments)
 * 2. Count code lines (non-blank, non-comment lines)
 * 3. If commentLines / totalNonBlankLines > threshold, flag the file
 * 4. Minimum: don't flag files with fewer than 10 non-blank lines
 *
 * Default threshold: 0.5 (50% comment ratio)
 */

const DEFAULT_THRESHOLD = 0.5;
const MIN_NON_BLANK_LINES = 10;

interface LineCounts {
  commentLines: number;
  codeLines: number;
}

function countJavaScriptLines(source: string): LineCounts {
  const lines = source.split("\n");
  let commentLines = 0;
  let codeLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === "") continue;

    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    // Check for block comment start
    if (trimmed.startsWith("/*")) {
      commentLines++;
      if (!trimmed.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }

    // Check for single-line comment
    if (trimmed.startsWith("//")) {
      commentLines++;
      continue;
    }

    codeLines++;
  }

  return { commentLines, codeLines };
}

function countPythonLines(source: string): LineCounts {
  const lines = source.split("\n");
  let commentLines = 0;
  let codeLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blank lines
    if (trimmed === "") continue;

    // Check for single-line comment
    if (trimmed.startsWith("#")) {
      commentLines++;
      continue;
    }

    codeLines++;
  }

  return { commentLines, codeLines };
}

export const excessiveCommentRatio: Detector = {
  id: "excessive-comment-ratio",
  meta: {
    name: "Excessive Comment Ratio",
    description:
      "Detects files where comments dominate the code, often a sign of AI-generated verbose commenting",
    severity: "info",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    const threshold = (ctx.config.threshold as number) ?? DEFAULT_THRESHOLD;

    const counts =
      ctx.file.language === "python"
        ? countPythonLines(ctx.source)
        : countJavaScriptLines(ctx.source);

    const totalNonBlank = counts.commentLines + counts.codeLines;

    // Don't flag small files
    if (totalNonBlank < MIN_NON_BLANK_LINES) {
      return [];
    }

    const ratio = counts.commentLines / totalNonBlank;

    if (ratio > threshold) {
      const pct = Math.round(ratio * 100);
      return [
        makeLineFinding(
          "excessive-comment-ratio",
          ctx,
          1,
          1,
          `File has ${pct}% comment lines (${counts.commentLines} comments, ${counts.codeLines} code lines). Threshold: ${Math.round(threshold * 100)}%`,
          "info",
          "Reduce excessive comments. Good code should be self-documenting with comments reserved for explaining 'why', not 'what'.",
        ),
      ];
    }

    return [];
  },
};
