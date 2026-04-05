import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { findTestFunctions, isTestFile, makeLineFinding } from "./utils.js";

/**
 * Detects test files that don't test any error paths.
 * Only 11% of AI test suites include error testing.
 *
 * Known false-positive scenarios:
 * - Pure data transformation modules
 * - Companion *.error.test.* files exist
 */

const JS_ERROR_PATTERNS = [
  /\.rejects\b/,
  /\.toThrow\b/,
  /\.toThrowError\b/,
  /expect\s*\(\s*\(\s*\)\s*=>/,
  /\bcatch\s*\(/,
  /rejects\./,
  /t\.assert\.throws\b/,
  /t\.assert\.rejects\b/,
  /t\.throws\b/,
  /t\.rejects\b/,
  /assert\.throws\b/,
  /assert\.rejects\b/,
  /\.toThrowErrorMatchingSnapshot\b/,
  /\.toThrowErrorMatchingInlineSnapshot\b/,
];

const PY_ERROR_PATTERNS = [
  /assertRaises\b/,
  /pytest\.raises\b/,
  /with\s+self\.assertRaises\b/,
];

const MIN_TEST_COUNT = 3;

function hasCompanionErrorFile(filePath: string): boolean {
  try {
    const dir = dirname(filePath);
    const base = basename(filePath);
    const files = readdirSync(dir);
    // Check for *.error.test.* or *.errors.test.* companion
    const errorPattern = /\.errors?\.test\./;
    return files.some(
      (f) => f !== base && errorPattern.test(f),
    );
  } catch {
    return false;
  }
}

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  const root = ctx.root.root();
  const testFns = findTestFunctions(root, ctx.file.language);

  if (testFns.length < MIN_TEST_COUNT) return [];

  // Check for error-testing patterns
  const patterns =
    ctx.file.language === "python" ? PY_ERROR_PATTERNS : JS_ERROR_PATTERNS;
  for (const pattern of patterns) {
    if (pattern.test(ctx.source)) return [];
  }

  // Check for companion error test file
  if (hasCompanionErrorFile(ctx.file.absolutePath)) return [];

  return [
    makeLineFinding(
      "no-error-path-test",
      ctx,
      1,
      1,
      `Test file has ${testFns.length} tests but no error path testing (.rejects, .toThrow, assertRaises).`,
      "info",
      "Add tests for error cases: invalid input, network failures, edge conditions.",
    ),
  ];
}

export const noErrorPathTest: Detector = {
  id: "no-error-path-test",
  meta: {
    name: "No Error Path Test",
    description:
      "Detects test files with no error path testing",
    severity: "info",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
