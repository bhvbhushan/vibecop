import type { SgNode } from "@ast-grep/napi";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { findTestFunctions, hasJsAssertions, isTestFile, makeFinding } from "./utils.js";

/**
 * Detects control flow (if/switch/for/while) inside test function bodies
 * when the conditional contains assertions. Assertions inside conditionals
 * may not execute, giving false confidence.
 *
 * Known false-positive scenarios:
 * - test.each/it.each parameterized tests
 * - Conditional setup logic (no assertions inside)
 * - TypeScript type narrowing: if (!result.success) { expect(result.error...) }
 */

const CONDITIONAL_KINDS = new Set([
  "if_statement",
  "switch_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "ternary_expression",
]);

const PY_CONDITIONAL_KINDS = new Set([
  "if_statement",
  "for_statement",
  "while_statement",
]);

function containsAssertion(node: SgNode, language: string): boolean {
  if (language === "python") {
    return node.findAll({ rule: { kind: "assert_statement" } }).length > 0;
  }
  return hasJsAssertions(node);
}

/**
 * Detect TypeScript type narrowing patterns like:
 *   if (!result.success) { ... }
 *   if (result.success === false) { ... }
 * These are discriminated union patterns, not conditional test logic.
 */
function isTypeNarrowingIf(node: SgNode): boolean {
  if (node.kind() !== "if_statement") return false;

  const children = node.children();
  // Find the parenthesized_expression (condition)
  const condWrapper = children.find(
    (c) => c.kind() === "parenthesized_expression",
  );
  if (!condWrapper) return false;

  const condText = condWrapper.text();
  // Match: (!x.success), (!x.ok), (x.success === false), (x.ok === false)
  if (/^\(\s*![\w.]+\.(success|ok|valid)\s*\)$/.test(condText)) return true;
  if (/^\(\s*[\w.]+\.(success|ok|valid)\s*===?\s*false\s*\)$/.test(condText)) return true;
  return false;
}

function isEachPattern(testNode: SgNode): boolean {
  const children = testNode.children();
  if (children.length === 0) return false;

  const callee = children[0];
  // test.each(...)('name', fn) — callee is a call_expression whose callee is member_expression
  if (callee.kind() === "call_expression") {
    const innerCallee = callee.children()[0];
    if (innerCallee?.kind() === "member_expression") {
      const prop = innerCallee
        .children()
        .find((c) => c.kind() === "property_identifier");
      if (prop?.text() === "each") return true;
    }
  }
  return false;
}

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  const root = ctx.root.root();
  const testFns = findTestFunctions(root, ctx.file.language);
  const conditionalKinds =
    ctx.file.language === "python" ? PY_CONDITIONAL_KINDS : CONDITIONAL_KINDS;
  const findings: Finding[] = [];

  for (const tf of testFns) {
    if (isEachPattern(tf.node)) continue;

    // Search for conditional nodes inside the test body
    for (const kind of conditionalKinds) {
      const conditionals = tf.body.findAll({ rule: { kind } });
      for (const cond of conditionals) {
        if (!containsAssertion(cond, ctx.file.language)) continue;
        // Skip TypeScript type narrowing patterns
        if (ctx.file.language !== "python" && isTypeNarrowingIf(cond)) continue;

        const typeLabel =
          kind === "ternary_expression" ? "ternary" : kind.replace("_", " ").replace("_", " ");
        findings.push(
          makeFinding(
            "conditional-test-logic",
            ctx,
            cond,
            `Test '${tf.name}' contains ${typeLabel} with assertions inside. Some assertions may not execute depending on runtime conditions.`,
            "info",
            "Extract conditional scenarios into separate test cases, or use test.each() for parameterized testing.",
          ),
        );
      }
    }
  }

  return findings;
}

export const conditionalTestLogic: Detector = {
  id: "conditional-test-logic",
  meta: {
    name: "Conditional Test Logic",
    description:
      "Detects control flow with assertions inside test functions where some assertions may not execute",
    severity: "info",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
