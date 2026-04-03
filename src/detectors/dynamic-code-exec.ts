import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects dynamic code execution with non-literal arguments:
 * - JS: eval(variable), new Function(variable) — only when arg is not a string literal
 * - Python: eval(variable), exec(variable) — only when arg is not a string literal
 *
 * This is a more targeted version than insecure-defaults: it only fires when
 * the argument is provably dynamic (variable, template literal, f-string).
 */

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // 1. eval() with dynamic argument
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "identifier" || callee.text() !== "eval") continue;

    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];
    // Only flag if NOT a string literal
    if (firstArg.kind() === "string" || firstArg.kind() === "string_fragment") continue;

    findings.push(
      makeFinding(
        "dynamic-code-exec",
        ctx,
        call,
        "eval() called with dynamic argument — arbitrary code execution risk",
        "error",
        "Avoid eval() with dynamic input. Use JSON.parse() for data or refactor to avoid dynamic code",
      ),
    );
  }

  // 2. new Function() with dynamic argument
  const newExprs = root.findAll({ rule: { kind: "new_expression" } });
  for (const newExpr of newExprs) {
    const children = newExpr.children();
    const constructorNode = children.find((ch) => ch.kind() === "identifier");
    if (!constructorNode || constructorNode.text() !== "Function") continue;

    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
    if (argNodes.length === 0) continue;

    // Check the last argument (the function body) for new Function(args..., body)
    const lastArg = argNodes[argNodes.length - 1];
    if (lastArg.kind() === "string" || lastArg.kind() === "string_fragment") continue;

    findings.push(
      makeFinding(
        "dynamic-code-exec",
        ctx,
        newExpr,
        "new Function() called with dynamic argument — arbitrary code execution risk",
        "error",
        "Avoid new Function() with dynamic input. Use static function definitions instead",
      ),
    );
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const calls = root.findAll({ rule: { kind: "call" } });
  for (const call of calls) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "identifier") continue;

    const funcName = callee.text();
    if (funcName !== "eval" && funcName !== "exec") continue;

    const argList = children.find((ch) => ch.kind() === "argument_list");
    if (!argList) continue;

    const argNodes = argList
      .children()
      .filter(
        (ch) =>
          ch.kind() !== "(" &&
          ch.kind() !== ")" &&
          ch.kind() !== "," &&
          ch.kind() !== "keyword_argument",
      );
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];

    // In Python, string literals (including f-strings) are "string" nodes.
    // Plain strings don't start with "f", f-strings do.
    if (firstArg.kind() === "string") {
      const text = firstArg.text();
      if (!text.startsWith("f\"") && !text.startsWith("f'")) {
        // Plain string literal — safe
        continue;
      }
      // f-string — dynamic, flag it
    } else if (firstArg.kind() === "identifier" || firstArg.kind() === "binary_operator" || firstArg.kind() === "concatenated_string") {
      // Dynamic input — flag it
    } else {
      // Unknown pattern — skip to avoid false positives
      continue;
    }

    findings.push(
      makeFinding(
        "dynamic-code-exec",
        ctx,
        call,
        `${funcName}() called with dynamic argument — arbitrary code execution risk`,
        "error",
        `Avoid ${funcName}() with dynamic input. Use ast.literal_eval() for safe expression evaluation`,
      ),
    );
  }

  return findings;
}

export const dynamicCodeExec: Detector = {
  id: "dynamic-code-exec",
  meta: {
    name: "Dynamic Code Execution",
    description:
      "Detects eval() and new Function() / exec() with dynamic (non-literal) arguments",
    severity: "error",
    category: "security",
    languages: ["javascript", "typescript", "tsx", "python"],
    priority: 10,
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
