import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

function detect(ctx: DetectionContext): Finding[] {
  if (ctx.file.language !== "typescript" && ctx.file.language !== "tsx") return [];
  if (TEST_FILE_RE.test(ctx.file.path)) return [];

  const root = ctx.root.root();
  const doubleAssertions = root.findAll({
    rule: {
      kind: "as_expression",
      has: {
        kind: "as_expression",
      },
    },
  });

  return doubleAssertions.map((node) =>
    makeFinding(
      "double-type-assertion",
      ctx,
      node,
      "Double type assertion (as unknown as X) bypasses TypeScript's type safety",
      "warning",
      "Fix the underlying type mismatch instead of using double assertion. Add a proper type guard or fix the type definition.",
    ),
  );
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
