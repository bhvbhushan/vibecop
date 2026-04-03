import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  // Only relevant for TypeScript, skip test files
  if (ctx.file.language !== "typescript" && ctx.file.language !== "tsx") return findings;
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  // Use regex since `as` expressions in TypeScript are hard to match via AST in all cases
  const lines = ctx.source.split("\n");
  const doubleAssertRe = /\bas\s+unknown\s+as\s+/;
  const doubleAssertRe2 = /\bas\s+any\s+as\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    const match = line.match(doubleAssertRe) || line.match(doubleAssertRe2);
    if (!match) continue;

    findings.push(makeLineFinding(
      "double-type-assertion",
      ctx,
      i + 1,
      (match.index ?? 0) + 1,
      "Double type assertion (as unknown as X) bypasses TypeScript's type safety",
      "warning",
      "Fix the underlying type mismatch instead of using double assertion. Add a proper type guard or fix the type definition.",
    ));
  }

  return findings;
}

export const doubleTypeAssertion: Detector = {
  id: "double-type-assertion",
  meta: {
    name: "Double Type Assertion",
    description: "Detects 'as unknown as X' double type assertions that bypass TypeScript type checking",
    severity: "warning",
    category: "quality",
    languages: ["typescript", "tsx"],
  },
  detect,
};
