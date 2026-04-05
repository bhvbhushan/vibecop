import type { Detector, DetectionContext, Finding } from "../types.js";
import { isTestFile, makeLineFinding } from "./utils.js";

/**
 * Detects test files where mocking dominates over assertions.
 *
 * JS/TS mocks: jest.mock(), jest.spyOn(), vi.mock(), vi.spyOn(),
 *   sinon.stub(), sinon.spy(), sinon.mock()
 * JS/TS assertions: expect(...).toX(), expect(...).not.toX(), assert.X()
 *
 * Python mocks: @patch, @mock.patch, mock.Mock(), mock.MagicMock(),
 *   unittest.mock.patch, mocker.patch
 * Python assertions: assert, assertEqual, assertTrue, assertFalse,
 *   assertRaises, assertIn, etc.
 *
 * Only runs on test files (path contains test, spec, __test__, __spec__).
 * Flags when mockCount > assertionCount * ratio (default ratio: 1.0).
 */

const DEFAULT_RATIO = 1.0;

// JS/TS mock patterns
const JS_MOCK_PATTERNS = [
  /jest\.mock\s*\(/g,
  /jest\.spyOn\s*\(/g,
  /vi\.mock\s*\(/g,
  /vi\.spyOn\s*\(/g,
  /sinon\.stub\s*\(/g,
  /sinon\.spy\s*\(/g,
  /sinon\.mock\s*\(/g,
];

// JS/TS assertion patterns
const JS_ASSERTION_PATTERNS = [
  /expect\s*\([^)]*\)\s*\.\s*(?:not\s*\.\s*)?to\w+/g,
  /assert\s*\.\s*\w+\s*\(/g,
];

// Python mock patterns
const PY_MOCK_PATTERNS = [
  /@patch\b/g,
  /@mock\.patch\b/g,
  /mock\.Mock\s*\(/g,
  /mock\.MagicMock\s*\(/g,
  /unittest\.mock\.patch\b/g,
  /mocker\.patch\s*\(/g,
  /MagicMock\s*\(/g,
  /Mock\s*\(/g,
];

// Python assertion patterns
const PY_ASSERTION_PATTERNS = [
  /\bassert\b/g,
  /\.assertEqual\s*\(/g,
  /\.assertTrue\s*\(/g,
  /\.assertFalse\s*\(/g,
  /\.assertRaises\s*\(/g,
  /\.assertIn\s*\(/g,
  /\.assertNotIn\s*\(/g,
  /\.assertIs\s*\(/g,
  /\.assertIsNot\s*\(/g,
  /\.assertIsNone\s*\(/g,
  /\.assertIsNotNone\s*\(/g,
  /\.assertGreater\s*\(/g,
  /\.assertLess\s*\(/g,
  /\.assertAlmostEqual\s*\(/g,
  /\.assertNotEqual\s*\(/g,
  /\.assertRegex\s*\(/g,
  /\.assertNotRegex\s*\(/g,
];

function countMatches(source: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    // Reset lastIndex for global regexps
    pattern.lastIndex = 0;
    const matches = source.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function detectJsMocking(ctx: DetectionContext): Finding[] {
  const mockCount = countMatches(ctx.source, JS_MOCK_PATTERNS);
  const assertionCount = countMatches(ctx.source, JS_ASSERTION_PATTERNS);

  const ratio = (ctx.config.ratio as number) ?? DEFAULT_RATIO;

  if (mockCount > 0 && mockCount > assertionCount * ratio) {
    return [
      makeLineFinding(
        "over-mocking",
        ctx,
        1,
        1,
        `Test file has more mocks (${mockCount}) than assertions (${assertionCount}). Tests that over-mock may not verify real behavior.`,
        "warning",
        "Reduce mocking and add more assertions. Consider integration tests for heavily-mocked code.",
      ),
    ];
  }

  return [];
}

function detectPythonMocking(ctx: DetectionContext): Finding[] {
  const mockCount = countMatches(ctx.source, PY_MOCK_PATTERNS);
  const assertionCount = countMatches(ctx.source, PY_ASSERTION_PATTERNS);

  const ratio = (ctx.config.ratio as number) ?? DEFAULT_RATIO;

  if (mockCount > 0 && mockCount > assertionCount * ratio) {
    return [
      makeLineFinding(
        "over-mocking",
        ctx,
        1,
        1,
        `Test file has more mocks (${mockCount}) than assertions (${assertionCount}). Tests that over-mock may not verify real behavior.`,
        "warning",
        "Reduce mocking and add more assertions. Consider integration tests for heavily-mocked code.",
      ),
    ];
  }

  return [];
}

export const overMocking: Detector = {
  id: "over-mocking",
  meta: {
    name: "Over-Mocking",
    description:
      "Detects test files where mocking dominates over assertions, suggesting tests may not verify real behavior",
    severity: "warning",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    // Only run on test files
    if (!isTestFile(ctx.file.path)) {
      return [];
    }

    if (ctx.file.language === "python") {
      return detectPythonMocking(ctx);
    }
    return detectJsMocking(ctx);
  },
};
