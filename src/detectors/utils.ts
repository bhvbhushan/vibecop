import type { SgNode } from "@ast-grep/napi";
import type { DetectionContext, Finding, Lang, Severity } from "../types.js";

/** Pattern matching test file paths (test, spec, __test__, __spec__) */
export const TEST_FILE_PATTERN =
  /(?:test|spec|__test__|__spec__)/i;

/** Check if a file path looks like a test file */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

/** A test function discovered in the AST */
export interface TestFunction {
  node: SgNode;
  name: string;
  body: SgNode;
}

/**
 * Find test function AST nodes in a parsed file.
 *
 * JS/TS: it()/test() call_expressions
 * Python: function_definition whose name starts with test_
 */
export function findTestFunctions(
  root: SgNode,
  language: Lang,
): TestFunction[] {
  if (language === "python") {
    return findPythonTestFunctions(root);
  }
  return findJsTestFunctions(root);
}

function findJsTestFunctions(root: SgNode): TestFunction[] {
  const results: TestFunction[] = [];
  const calls = root.findAll({ rule: { kind: "call_expression" } });

  for (const call of calls) {
    const children = call.children();
    if (children.length < 2) continue;

    const callee = children[0];
    const args = children[1];

    // Match it('name', fn) or test('name', fn)
    let isTestCall = false;
    if (callee.kind() === "identifier") {
      const name = callee.text();
      isTestCall = name === "it" || name === "test";
    }
    // Match it.each(...)('name', fn) or test.each(...)('name', fn)
    // Also match describe('name', fn) — but we only want it/test
    if (!isTestCall && callee.kind() === "call_expression") {
      // This handles test.each(...)(...) — the outer call is what findTestFunctions returns
      const innerChildren = callee.children();
      if (innerChildren.length >= 1) {
        const innerCallee = innerChildren[0];
        if (innerCallee.kind() === "member_expression") {
          const memberChildren = innerCallee.children();
          const obj = memberChildren[0];
          const prop = memberChildren.find(
            (c) => c.kind() === "property_identifier",
          );
          if (
            obj &&
            prop &&
            obj.kind() === "identifier" &&
            (obj.text() === "it" || obj.text() === "test") &&
            prop.text() === "each"
          ) {
            isTestCall = true;
          }
        }
      }
    }

    if (!isTestCall) continue;

    // Extract test name from first argument
    const argChildren = args
      .children()
      .filter(
        (ch) =>
          ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",",
      );
    if (argChildren.length < 2) continue;

    const nameNode = argChildren[0];
    const callbackNode = argChildren[1];

    const testName =
      nameNode.kind() === "string"
        ? nameNode.text().slice(1, -1)
        : nameNode.kind() === "template_string"
          ? nameNode.text().slice(1, -1)
          : nameNode.text();

    // Get the callback body
    let body: SgNode | null = null;
    if (
      callbackNode.kind() === "arrow_function" ||
      callbackNode.kind() === "function_expression"
    ) {
      // Body is the statement_block child
      body =
        callbackNode
          .children()
          .find((c) => c.kind() === "statement_block") ??
        callbackNode; // concise arrow: () => expr
    }

    if (body) {
      results.push({ node: call, name: testName, body });
    }
  }

  return results;
}

function findPythonTestFunctions(root: SgNode): TestFunction[] {
  const results: TestFunction[] = [];
  const funcDefs = root.findAll({
    rule: { kind: "function_definition" },
  });

  for (const funcDef of funcDefs) {
    const nameNode = funcDef.children().find((c) => c.kind() === "identifier");
    if (!nameNode) continue;

    const name = nameNode.text();
    if (!name.startsWith("test_")) continue;

    const body = funcDef.children().find((c) => c.kind() === "block");
    if (!body) continue;

    results.push({ node: funcDef, name, body });
  }

  return results;
}

/**
 * Count JS/TS assertion calls inside an AST node.
 * Recognizes: expect(), assert.*(), t.assert.*(), t.plan(),
 * assertType(), expectTypeOf(), should.*()
 */
export function countJsAssertions(body: SgNode): number {
  const allCalls = body.findAll({ rule: { kind: "call_expression" } });
  let count = 0;
  for (const call of allCalls) {
    const callee = call.children()[0];
    if (!callee) continue;

    // expect(...), assert*(...), expectTypeOf(...), and custom wrappers like expectMethodMatch(...)
    if (callee.kind() === "identifier") {
      const name = callee.text();
      if (
        name === "expect" ||
        name.startsWith("expect") || // expectTypeOf, expectMethodMatch, etc.
        name.startsWith("assert")    // assertType, assertEqual, etc.
      )
        count++;
      continue;
    }

    // assert.*(), t.assert.*(), t.plan(), should.*()
    if (callee.kind() === "member_expression") {
      const parts = callee.children();
      const obj = parts[0];
      const prop = parts.find((c) => c.kind() === "property_identifier");
      if (!obj || !prop) continue;

      // assert.strictEqual(), assert.ok(), etc.
      if (obj.kind() === "identifier" && obj.text() === "assert") {
        count++;
        continue;
      }

      // t.assert.*, t.plan(), t.ok(), t.strictEqual()
      if (obj.kind() === "identifier" && obj.text() === "t") {
        const pText = prop.text();
        if (pText === "plan" || pText === "ok" || pText === "equal" ||
            pText === "strictEqual" || pText === "deepEqual" ||
            pText === "notEqual" || pText === "throws" || pText === "rejects") {
          count++;
          continue;
        }
      }

      // t.assert.strictEqual() — nested member_expression
      if (obj.kind() === "member_expression") {
        const innerParts = obj.children();
        const innerObj = innerParts[0];
        const innerProp = innerParts.find(
          (c) => c.kind() === "property_identifier",
        );
        if (
          innerObj?.kind() === "identifier" &&
          innerObj.text() === "t" &&
          innerProp?.text() === "assert"
        ) {
          count++;
          continue;
        }
      }
    }
  }
  return count;
}

/**
 * Count Python assertion statements inside an AST node.
 * Recognizes: assert, pytest.raises, self.assert*
 */
export function countPyAssertions(body: SgNode): number {
  let count = body.findAll({ rule: { kind: "assert_statement" } }).length;
  // Count pytest.raises context managers
  const withStmts = body.findAll({ rule: { kind: "with_statement" } });
  for (const ws of withStmts) {
    const text = ws.text();
    if (text.includes("pytest.raises") || text.includes("assertRaises"))
      count++;
  }
  return count;
}

/**
 * Check if a JS/TS body contains any assertion (broad recognition).
 */
export function hasJsAssertions(body: SgNode): boolean {
  return countJsAssertions(body) > 0;
}

/**
 * Check if source text has type-testing patterns (no runtime assertions).
 * These files use @ts-expect-error or expectTypeOf for compile-time checks.
 */
export function isTypeTestFile(source: string): boolean {
  // Count @ts-expect-error occurrences — if they dominate, it's a type test
  const tsExpectCount = (source.match(/@ts-expect-error/g) ?? []).length;
  return tsExpectCount >= 3;
}

/**
 * Create a Finding from an AST node (ast-grep based detectors).
 * Extracts line/column/endLine/endColumn from the node's range,
 * converting from 0-indexed (ast-grep) to 1-indexed (Finding).
 */
export function makeFinding(
  detectorId: string,
  ctx: DetectionContext,
  node: SgNode,
  message: string,
  severity: Severity,
  suggestion?: string,
): Finding {
  const range = node.range();
  return {
    detectorId,
    message,
    severity,
    file: ctx.file.path,
    line: range.start.line + 1,
    column: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
    ...(suggestion != null && { suggestion }),
  };
}

/**
 * Create a Finding from explicit line/column values (regex/line-based detectors).
 * Line and column should already be 1-indexed.
 * Pass endLine/endColumn when range info is available.
 */
export function makeLineFinding(
  detectorId: string,
  ctx: DetectionContext,
  line: number,
  column: number,
  message: string,
  severity: Severity,
  suggestion?: string,
  endLine?: number,
  endColumn?: number,
): Finding {
  return {
    detectorId,
    message,
    severity,
    file: ctx.file.path,
    line,
    column,
    ...(suggestion != null && { suggestion }),
    ...(endLine != null && { endLine }),
    ...(endColumn != null && { endColumn }),
  };
}
