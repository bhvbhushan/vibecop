import type { SgNode } from "@ast-grep/napi";
import type { Detector, DetectionContext, Finding } from "../types.js";
import {
  countPyAssertions,
  findTestFunctions,
  hasJsAssertions,
  isTestFile,
  isTypeTestFile,
  makeFinding,
} from "./utils.js";

/**
 * Detects test functions with zero assertions.
 * 37.7% prevalence in LLM-generated tests.
 *
 * Known false-positive mitigations:
 * - done() callback style async tests → skip
 * - expect.assertions(N) / expect.hasAssertions() → skip
 * - t.plan(N) / t.assert.* (Node.js test runner) → recognized as assertions
 * - assertType / expectTypeOf (type tests) → recognized as assertions
 * - @ts-expect-error heavy files (type test files) → skip entire file
 */

function hasDoneCallback(testNode: SgNode): boolean {
  const args = testNode.children()[1];
  if (!args) return false;

  const argChildren = args
    .children()
    .filter(
      (ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",",
    );
  if (argChildren.length < 2) return false;

  const callback = argChildren[1];
  if (
    callback.kind() !== "arrow_function" &&
    callback.kind() !== "function_expression"
  )
    return false;

  const params = callback
    .children()
    .find((c) => c.kind() === "formal_parameters");
  if (!params) return false;

  const paramChildren = params
    .children()
    .filter((c) => c.kind() !== "(" && c.kind() !== ")");
  return paramChildren.length > 0;
}

function hasExpectAssertionsCall(body: SgNode): boolean {
  const source = body.text();
  return (
    source.includes("expect.assertions(") ||
    source.includes("expect.hasAssertions(")
  );
}

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  // Skip type test files (heavy @ts-expect-error usage)
  if (ctx.file.language !== "python" && isTypeTestFile(ctx.source)) return [];

  const root = ctx.root.root();
  const testFns = findTestFunctions(root, ctx.file.language);
  const findings: Finding[] = [];

  for (const tf of testFns) {
    // Check assertions based on language
    if (ctx.file.language === "python") {
      if (countPyAssertions(tf.body) > 0) continue;
    } else {
      if (hasJsAssertions(tf.body)) continue;
      if (hasDoneCallback(tf.node)) continue;
      if (hasExpectAssertionsCall(tf.body)) continue;
    }

    findings.push(
      makeFinding(
        "empty-test",
        ctx,
        tf.node,
        `Test '${tf.name}' has no assertions. Tests without assertions always pass and provide false confidence.`,
        "info",
        "Add expect() or assert statements to verify the behavior under test.",
      ),
    );
  }

  return findings;
}

export const emptyTest: Detector = {
  id: "empty-test",
  meta: {
    name: "Empty Test",
    description:
      "Detects test functions with zero assertions that always pass",
    severity: "info",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
