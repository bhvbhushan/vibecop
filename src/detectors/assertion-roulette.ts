import type { Detector, DetectionContext, Finding } from "../types.js";
import {
  countJsAssertions,
  countPyAssertions,
  findTestFunctions,
  isTestFile,
  makeFinding,
} from "./utils.js";

const DEFAULT_MAX_ASSERTIONS = 8;

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  const root = ctx.root.root();
  const testFns = findTestFunctions(root, ctx.file.language);
  const maxAssertions =
    (ctx.config.maxAssertions as number) ?? DEFAULT_MAX_ASSERTIONS;
  const findings: Finding[] = [];

  for (const tf of testFns) {
    const count =
      ctx.file.language === "python"
        ? countPyAssertions(tf.body)
        : countJsAssertions(tf.body);

    if (count > maxAssertions) {
      findings.push(
        makeFinding(
          "assertion-roulette",
          ctx,
          tf.node,
          `Test '${tf.name}' has ${count} assertions. Split into focused tests for clearer failure diagnosis.`,
          "warning",
          "Break this test into smaller, focused tests with 1-3 assertions each.",
        ),
      );
    }
  }

  return findings;
}

export const assertionRoulette: Detector = {
  id: "assertion-roulette",
  meta: {
    name: "Assertion Roulette",
    description:
      "Detects test functions with too many assertions, making failure diagnosis difficult",
    severity: "warning",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
