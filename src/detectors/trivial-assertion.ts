import type { Detector, DetectionContext, Finding } from "../types.js";
import { isTestFile, makeFinding } from "./utils.js";

/**
 * Detects test assertions that prove nothing:
 * - expect(true).toBe(true) / expect(false).toBe(false)
 * - expect(1).toBe(1) — literal === literal
 * - expect("foo").toBe("foo") — string literal === same string literal
 * - expect(true).toBeTruthy() / expect(false).toBeFalsy() — tautological
 * - Python: assert True, assert False, assert 1 == 1
 *
 * Only runs on test files (path contains test, spec, __test__, __spec__).
 */

const LITERAL_KINDS_JS = new Set([
  "true",
  "false",
  "number",
  "string",
]);

const LITERAL_KINDS_PY = new Set([
  "true",
  "false",
  "integer",
  "float",
  "string",
]);

/** Normalize string literal text for comparison (handle single vs double quotes) */
function normalizeStringLiteral(text: string): string {
  // Remove surrounding quotes and return inner value
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("`") && text.endsWith("`"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function detectJavaScriptTrivialAssertions(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Find all call_expression nodes (outermost ones that represent full expect chains)
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });

  for (const call of callExprs) {
    const children = call.children();
    if (children.length < 2) continue;

    const fnPart = children[0];
    const argsPart = children[1];

    // Pattern 1: expect(LITERAL).toBe(SAME_LITERAL) or .toEqual(SAME_LITERAL)
    if (fnPart.kind() === "member_expression") {
      const memberChildren = fnPart.children();
      // member_expression has: object, '.', property
      const object = memberChildren[0];
      const property = memberChildren.find(
        (ch) => ch.kind() === "property_identifier",
      );

      if (!object || !property) continue;
      if (object.kind() !== "call_expression") continue;

      // Check the inner call is expect(LITERAL)
      const innerChildren = object.children();
      if (innerChildren.length < 2) continue;
      const innerFn = innerChildren[0];
      const innerArgs = innerChildren[1];

      if (innerFn.kind() !== "identifier" || innerFn.text() !== "expect") {
        continue;
      }

      // Get the argument to expect()
      const expectArgNodes = innerArgs
        .children()
        .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
      if (expectArgNodes.length !== 1) continue;
      const expectArg = expectArgNodes[0];

      if (!LITERAL_KINDS_JS.has(expectArg.kind() as string)) continue;

      const methodName = property.text();

      // Check for toBeTruthy() with true, toBeFalsy() with false
      if (methodName === "toBeTruthy" && expectArg.text() === "true") {
        findings.push(makeFinding(
          "trivial-assertion",
          ctx,
          call,
          "Trivial assertion: expect(true).toBeTruthy() always passes",
          "warning",
          "Replace with a meaningful assertion that tests actual behavior",
        ));
        continue;
      }

      if (methodName === "toBeFalsy" && expectArg.text() === "false") {
        findings.push(makeFinding(
          "trivial-assertion",
          ctx,
          call,
          "Trivial assertion: expect(false).toBeFalsy() always passes",
          "warning",
          "Replace with a meaningful assertion that tests actual behavior",
        ));
        continue;
      }

      // Check for toBe/toEqual with same literal
      if (methodName !== "toBe" && methodName !== "toEqual") continue;

      // Get the matcher argument
      const matcherArgNodes = argsPart
        .children()
        .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
      if (matcherArgNodes.length !== 1) continue;
      const matcherArg = matcherArgNodes[0];

      if (!LITERAL_KINDS_JS.has(matcherArg.kind() as string)) continue;

      // Compare the two literals
      let areSame = false;
      if (expectArg.kind() === "string" && matcherArg.kind() === "string") {
        areSame =
          normalizeStringLiteral(expectArg.text()) ===
          normalizeStringLiteral(matcherArg.text());
      } else {
        areSame = expectArg.text() === matcherArg.text();
      }

      if (areSame) {
        findings.push(makeFinding(
          "trivial-assertion",
          ctx,
          call,
          `Trivial assertion: expect(${expectArg.text()}).${methodName}(${matcherArg.text()}) always passes`,
          "warning",
          "Replace with a meaningful assertion that tests actual behavior",
        ));
      }
    }
  }

  return findings;
}

function detectPythonTrivialAssertions(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const assertStmts = root.findAll({ rule: { kind: "assert_statement" } });

  for (const assertNode of assertStmts) {
    const children = assertNode.children();
    // children[0] is "assert", children[1] is the expression
    if (children.length < 2) continue;

    const expr = children[1];

    // assert True / assert False
    if (expr.kind() === "true" || expr.kind() === "false") {
      findings.push(makeFinding(
        "trivial-assertion",
        ctx,
        assertNode,
        `Trivial assertion: assert ${expr.text()} always ${expr.kind() === "true" ? "passes" : "fails"}`,
        "warning",
        "Replace with a meaningful assertion that tests actual behavior",
      ));
      continue;
    }

    // assert LITERAL == SAME_LITERAL (e.g., assert 1 == 1)
    if (expr.kind() === "comparison_operator") {
      const compChildren = expr.children();
      // Should be: left, ==, right
      if (compChildren.length === 3 && compChildren[1].text() === "==") {
        const left = compChildren[0];
        const right = compChildren[2];

        if (
          LITERAL_KINDS_PY.has(left.kind() as string) &&
          LITERAL_KINDS_PY.has(right.kind() as string)
        ) {
          let areSame = false;
          if (left.kind() === "string" && right.kind() === "string") {
            areSame =
              normalizeStringLiteral(left.text()) ===
              normalizeStringLiteral(right.text());
          } else {
            areSame = left.text() === right.text();
          }

          if (areSame) {
            findings.push(makeFinding(
              "trivial-assertion",
              ctx,
              assertNode,
              `Trivial assertion: assert ${left.text()} == ${right.text()} always passes`,
              "warning",
              "Replace with a meaningful assertion that tests actual behavior",
            ));
          }
        }
      }
    }
  }

  return findings;
}

export const trivialAssertion: Detector = {
  id: "trivial-assertion",
  meta: {
    name: "Trivial Assertion",
    description:
      "Detects test assertions that compare identical literals and always pass",
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
      return detectPythonTrivialAssertions(ctx);
    }
    return detectJavaScriptTrivialAssertions(ctx);
  },
};
