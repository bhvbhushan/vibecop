import type { SgNode } from "@ast-grep/napi";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

/** JS/TS branching node kinds that increase cyclomatic complexity */
const JS_BRANCHING_KINDS = new Set([
  "if_statement",
  "else_clause",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_case",
  "catch_clause",
  "ternary_expression",
  "conditional_expression",
]);

/** Python branching node kinds that increase cyclomatic complexity */
const PY_BRANCHING_KINDS = new Set([
  "if_statement",
  "elif_clause",
  "for_statement",
  "while_statement",
  "except_clause",
  "conditional_expression",
]);

interface FunctionMetrics {
  name: string;
  lines: number;
  complexity: number;
  params: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * Recursively count all descendants matching branching kinds,
 * plus logical operators (&& / || for JS, and/or for Python).
 */
function countComplexity(node: SgNode, isPython: boolean): number {
  let count = 0;
  const branchingKinds = isPython ? PY_BRANCHING_KINDS : JS_BRANCHING_KINDS;

  for (const child of node.children()) {
    const k = String(child.kind());

    if (branchingKinds.has(k)) {
      count++;
    }

    if (!isPython) {
      // Count logical && and || operators in binary expressions
      if (k === "binary_expression") {
        const op = child.children().find(ch => ch.kind() === "&&" || ch.kind() === "||");
        if (op) count++;
      }
    } else {
      // Python: count `and` / `or` boolean operators
      if (k === "boolean_operator") {
        const opText = child.children().find(ch => ch.kind() === "and" || ch.kind() === "or");
        if (opText) count++;
      }
    }

    count += countComplexity(child, isPython);
  }

  return count;
}

/** Count formal parameters for a JS/TS function node */
function countJsParams(funcNode: SgNode): number {
  const params = funcNode.children().find(
    ch => ch.kind() === "formal_parameters",
  );
  if (!params) return 0;

  return params.children().filter(ch => {
    const k = ch.kind();
    return k !== "(" && k !== ")" && k !== ",";
  }).length;
}

/** Count parameters for a Python function node */
function countPyParams(funcNode: SgNode): number {
  const params = funcNode.children().find(
    ch => ch.kind() === "parameters",
  );
  if (!params) return 0;

  const paramNodes = params.children().filter(ch => {
    const k = ch.kind();
    return k !== "(" && k !== ")" && k !== ",";
  });

  // Exclude `self` and `cls` as they are implicit
  return paramNodes.filter(ch => {
    const text = ch.text().split(":")[0].split("=")[0].trim();
    return text !== "self" && text !== "cls";
  }).length;
}

/** Get function name from a JS/TS function node or its parent context */
function getJsFunctionName(node: SgNode): string {
  const kind = node.kind();

  if (kind === "function_declaration") {
    const nameNode = node.children().find(ch => ch.kind() === "identifier");
    return nameNode?.text() ?? "<anonymous>";
  }

  if (kind === "method_definition") {
    const nameNode = node.children().find(
      ch => ch.kind() === "property_identifier" || ch.kind() === "identifier",
    );
    return nameNode?.text() ?? "<anonymous>";
  }

  if (kind === "arrow_function") {
    // Walk up to find variable_declarator parent
    const parent = node.parent();
    if (parent?.kind() === "variable_declarator") {
      const nameNode = parent.children().find(ch => ch.kind() === "identifier");
      return nameNode?.text() ?? "<anonymous>";
    }
    // Property assignment: { key: () => {} }
    if (parent?.kind() === "pair") {
      const nameNode = parent.children().find(
        ch => ch.kind() === "property_identifier" || ch.kind() === "string",
      );
      return nameNode?.text() ?? "<anonymous>";
    }
    return "<anonymous>";
  }

  return "<anonymous>";
}

function buildFinding(
  ctx: DetectionContext,
  m: FunctionMetrics,
  severity: "error" | "warning",
): Finding {
  return makeLineFinding(
    "god-function",
    ctx,
    m.startLine,
    m.startColumn,
    `Function '${m.name}' is too complex (${m.lines} lines, cyclomatic complexity ${m.complexity}, ${m.params} params)`,
    severity,
    "Break this function into smaller, focused functions. Extract helper methods, use early returns, and reduce branching.",
    m.endLine,
    m.endColumn,
  );
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const maxLines = (ctx.config as Record<string, unknown>)?.maxLines as number ?? 50;
  const maxComplexity = (ctx.config as Record<string, unknown>)?.maxComplexity as number ?? 15;
  const maxParams = (ctx.config as Record<string, unknown>)?.maxParams as number ?? 5;

  const funcKinds = ["function_declaration", "method_definition", "arrow_function"];

  for (const kind of funcKinds) {
    const nodes = root.findAll({ rule: { kind } });

    for (const node of nodes) {
      const range = node.range();
      const lines = range.end.line - range.start.line + 1;

      // For arrow functions, skip short inline callbacks
      if (kind === "arrow_function") {
        if (lines <= 10) continue;
        // Only flag if assigned to a variable or property
        const parent = node.parent();
        if (!parent) continue;
        const pk = parent.kind();
        if (pk !== "variable_declarator" && pk !== "pair" && pk !== "assignment_expression") {
          continue;
        }
      }

      const name = getJsFunctionName(node);
      const complexity = 1 + countComplexity(node, false);
      const params = countJsParams(node);

      const linesExceeded = lines > maxLines;
      const complexityExceeded = complexity > maxComplexity;
      const paramsExceeded = params > maxParams;

      if (!linesExceeded && !complexityExceeded && !paramsExceeded) continue;

      // Skip pure markup/render functions: lots of lines but no branching logic
      if (!complexityExceeded && !paramsExceeded && complexity <= 2) continue;

      // Determine severity based on worst violation
      let severity: "error" | "warning" = "warning";
      if (lines > 100 || complexity > 20) {
        severity = "error";
      }

      const metrics: FunctionMetrics = {
        name,
        lines,
        complexity,
        params,
        startLine: range.start.line + 1,
        startColumn: range.start.column + 1,
        endLine: range.end.line + 1,
        endColumn: range.end.column + 1,
      };

      findings.push(buildFinding(ctx, metrics, severity));
    }
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const maxLines = (ctx.config as Record<string, unknown>)?.maxLines as number ?? 50;
  const maxComplexity = (ctx.config as Record<string, unknown>)?.maxComplexity as number ?? 15;
  const maxParams = (ctx.config as Record<string, unknown>)?.maxParams as number ?? 5;

  const funcNodes = root.findAll({ rule: { kind: "function_definition" } });

  for (const node of funcNodes) {
    const range = node.range();
    const lines = range.end.line - range.start.line + 1;
    const nameNode = node.children().find(ch => ch.kind() === "identifier");
    const name = nameNode?.text() ?? "<anonymous>";
    const complexity = 1 + countComplexity(node, true);
    const params = countPyParams(node);

    const linesExceeded = lines > maxLines;
    const complexityExceeded = complexity > maxComplexity;
    const paramsExceeded = params > maxParams;

    if (!linesExceeded && !complexityExceeded && !paramsExceeded) continue;

    // Skip pure template/markup functions: lots of lines but no branching logic
    if (!complexityExceeded && !paramsExceeded && complexity <= 2) continue;

    let severity: "error" | "warning" = "warning";
    if (lines > 100 || complexity > 20) {
      severity = "error";
    }

    const metrics: FunctionMetrics = {
      name,
      lines,
      complexity,
      params,
      startLine: range.start.line + 1,
      startColumn: range.start.column + 1,
      endLine: range.end.line + 1,
      endColumn: range.end.column + 1,
    };

    findings.push(buildFinding(ctx, metrics, severity));
  }

  return findings;
}

export const godFunction: Detector = {
  id: "god-function",
  meta: {
    name: "God Function",
    description:
      "Detects overly complex functions by measuring lines of code, cyclomatic complexity, and parameter count",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (TEST_FILE_RE.test(ctx.file.path)) return [];

    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
