import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects redundant defensive coding patterns (without type information):
 *
 * Pattern 1: Redundant null+undefined pair checks
 *   - x !== null && x !== undefined (use x != null instead)
 *   - x !== undefined && x !== null (same)
 *   - typeof x !== 'undefined' && x !== null (use x != null instead)
 *   - x != null && x != undefined (x != null already checks both)
 *
 * Pattern 2: try/catch around JSON.parse with a string literal argument
 *   - try { JSON.parse('{"key":"value"}') } catch (e) {} — literal can't fail
 *   - Does NOT flag JSON.parse(variable) — runtime input may fail
 */

/**
 * Check if an expression is a null/undefined check of the form:
 * `x !== null`, `x !== undefined`, `typeof x !== 'undefined'`, `x != null`, `x != undefined`
 *
 * Returns the variable name being checked, or null if not a nullish check.
 */
interface NullishCheck {
  variable: string;
  checksNull: boolean;
  checksUndefined: boolean;
  isLoose: boolean; // != vs !==
}

function parseNullishCheck(nodeText: string): NullishCheck | null {
  const trimmed = nodeText.trim();

  // typeof x !== 'undefined'
  const typeofMatch = trimmed.match(
    /^typeof\s+(\w+)\s*!==?\s*(['"])undefined\2$/,
  );
  if (typeofMatch) {
    return {
      variable: typeofMatch[1],
      checksNull: false,
      checksUndefined: true,
      isLoose: trimmed.includes("!=") && !trimmed.includes("!=="),
    };
  }

  // x !== null / x != null
  const nullMatch = trimmed.match(/^(\w+)\s*!==?\s*null$/);
  if (nullMatch) {
    return {
      variable: nullMatch[1],
      checksNull: true,
      checksUndefined: false,
      isLoose: trimmed.includes("!=") && !trimmed.includes("!=="),
    };
  }

  // x !== undefined / x != undefined
  const undefinedMatch = trimmed.match(/^(\w+)\s*!==?\s*undefined$/);
  if (undefinedMatch) {
    return {
      variable: undefinedMatch[1],
      checksNull: false,
      checksUndefined: true,
      isLoose: trimmed.includes("!=") && !trimmed.includes("!=="),
    };
  }

  // null !== x / null != x
  const nullLeftMatch = trimmed.match(/^null\s*!==?\s*(\w+)$/);
  if (nullLeftMatch) {
    return {
      variable: nullLeftMatch[1],
      checksNull: true,
      checksUndefined: false,
      isLoose: trimmed.includes("!=") && !trimmed.includes("!=="),
    };
  }

  // undefined !== x / undefined != x
  const undefinedLeftMatch = trimmed.match(/^undefined\s*!==?\s*(\w+)$/);
  if (undefinedLeftMatch) {
    return {
      variable: undefinedLeftMatch[1],
      checksNull: false,
      checksUndefined: true,
      isLoose: trimmed.includes("!=") && !trimmed.includes("!=="),
    };
  }

  return null;
}

function detectRedundantNullChecks(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Find binary_expression nodes with && operator
  const binaryExprs = root.findAll({ rule: { kind: "binary_expression" } });

  for (const expr of binaryExprs) {
    const children = expr.children();
    // binary_expression: left, operator, right
    if (children.length < 3) continue;

    const operator = children[1];
    if (operator.text() !== "&&") continue;

    const left = children[0];
    const right = children[2];

    const leftCheck = parseNullishCheck(left.text());
    const rightCheck = parseNullishCheck(right.text());

    if (!leftCheck || !rightCheck) continue;
    if (leftCheck.variable !== rightCheck.variable) continue;

    // Pattern 1a: Both are strict checks (one null, one undefined)
    if (
      !leftCheck.isLoose &&
      !rightCheck.isLoose &&
      ((leftCheck.checksNull && rightCheck.checksUndefined) ||
        (leftCheck.checksUndefined && rightCheck.checksNull))
    ) {
      findings.push(makeFinding(
        "over-defensive-coding",
        ctx,
        expr,
        `Redundant null+undefined check on '${leftCheck.variable}'. Use '${leftCheck.variable} != null' to check both.`,
        "info",
        `Replace with '${leftCheck.variable} != null' which checks both null and undefined`,
      ));
      continue;
    }

    // Pattern 1b: Loose checks — x != null && x != undefined (redundant since != null covers both)
    if (
      leftCheck.isLoose &&
      rightCheck.isLoose &&
      ((leftCheck.checksNull && rightCheck.checksUndefined) ||
        (leftCheck.checksUndefined && rightCheck.checksNull))
    ) {
      findings.push(makeFinding(
        "over-defensive-coding",
        ctx,
        expr,
        `Redundant check: '${leftCheck.variable} != null' already checks both null and undefined`,
        "info",
        `Use just '${leftCheck.variable} != null' — it checks both null and undefined`,
      ));
    }
  }

  return findings;
}

function detectJsonParseLiteralTryCatch(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Find try_statement nodes
  const tryStatements = root.findAll({ rule: { kind: "try_statement" } });

  for (const tryNode of tryStatements) {
    const children = tryNode.children();
    const tryBlock = children.find((ch) => ch.kind() === "statement_block");
    if (!tryBlock) continue;

    // Get meaningful children of try block
    const blockChildren = tryBlock.children().filter(
      (ch) => ch.kind() !== "{" && ch.kind() !== "}",
    );

    // Look for JSON.parse calls with string literal arguments
    for (const stmt of blockChildren) {
      const callExprs = stmt.findAll({ rule: { kind: "call_expression" } });
      for (const call of callExprs) {
        const callChildren = call.children();
        const fn = callChildren[0];
        if (!fn || fn.kind() !== "member_expression") continue;
        if (fn.text() !== "JSON.parse") continue;

        const args = callChildren.find((ch) => ch.kind() === "arguments");
        if (!args) continue;

        const argNodes = args.children().filter(
          (ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",",
        );
        if (argNodes.length !== 1) continue;

        const arg = argNodes[0];
        // Only flag string literals, not template literals or variables
        if (arg.kind() !== "string") continue;

        findings.push(makeFinding(
          "over-defensive-coding",
          ctx,
          tryNode,
          "Unnecessary try/catch around JSON.parse() with a string literal argument that cannot fail",
          "info",
          "Remove the try/catch — JSON.parse with a valid string literal will never throw",
        ));
      }
    }
  }

  return findings;
}

export const overDefensiveCoding: Detector = {
  id: "over-defensive-coding",
  meta: {
    name: "Over-Defensive Coding",
    description:
      "Detects redundant defensive patterns like null+undefined pair checks and unnecessary try/catch around JSON.parse with literals",
    severity: "info",
    category: "quality",
    languages: ["javascript", "typescript", "tsx"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") {
      return [];
    }

    const findings: Finding[] = [];
    findings.push(...detectRedundantNullChecks(ctx));
    findings.push(...detectJsonParseLiteralTryCatch(ctx));
    return findings;
  },
};
