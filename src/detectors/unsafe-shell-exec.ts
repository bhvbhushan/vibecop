import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects unsafe shell command execution:
 * - JS: exec()/execSync() with dynamic arguments (template literals or variables)
 * - Python: subprocess.run/call/Popen with shell=True and dynamic arguments
 *
 * Does NOT flag calls with string literal arguments (those are safe).
 */

const EXEC_FUNCTIONS = new Set(["exec", "execSync"]);
const SUBPROCESS_METHODS = new Set(["run", "call", "Popen", "check_output", "check_call"]);

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee) continue;

    // Check for exec() or execSync() — could be bare or member expr (child_process.exec)
    let isExecCall = false;
    if (callee.kind() === "identifier" && EXEC_FUNCTIONS.has(callee.text())) {
      isExecCall = true;
    } else if (callee.kind() === "member_expression") {
      const text = callee.text();
      for (const fn of EXEC_FUNCTIONS) {
        if (text.endsWith(`.${fn}`)) {
          isExecCall = true;
          break;
        }
      }
    }
    if (!isExecCall) continue;

    // Get the first argument
    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];
    const argKind = firstArg.kind();

    // Only flag if the argument is dynamic (not a plain string literal)
    if (argKind === "string" || argKind === "string_fragment") continue;

    findings.push(
      makeFinding(
        "unsafe-shell-exec",
        ctx,
        call,
        `${callee.text()}() called with dynamic argument — risk of shell injection`,
        "error",
        "Use execFile() or spawn() with an argument array instead of exec() with string interpolation",
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
    if (!callee) continue;

    // Check for subprocess.run/call/Popen
    const calleeText = callee.text();
    let isSubprocessCall = false;
    for (const method of SUBPROCESS_METHODS) {
      if (
        calleeText === `subprocess.${method}` ||
        calleeText.endsWith(`.${method}`)
      ) {
        isSubprocessCall = true;
        break;
      }
    }
    if (!isSubprocessCall) continue;

    // Check for shell=True keyword argument
    const argList = children.find((ch) => ch.kind() === "argument_list");
    if (!argList) continue;

    const kwargs = argList
      .children()
      .filter((ch) => ch.kind() === "keyword_argument");
    let hasShellTrue = false;
    for (const kwarg of kwargs) {
      const kwChildren = kwarg.children();
      const key = kwChildren.find((ch) => ch.kind() === "identifier");
      const value = kwChildren.find((ch) => ch.kind() === "true");
      if (key && value && key.text() === "shell") {
        hasShellTrue = true;
        break;
      }
    }
    if (!hasShellTrue) continue;

    // Check the first positional argument — only flag if dynamic
    const positionalArgs = argList
      .children()
      .filter(
        (ch) =>
          ch.kind() !== "(" &&
          ch.kind() !== ")" &&
          ch.kind() !== "," &&
          ch.kind() !== "keyword_argument",
      );
    if (positionalArgs.length === 0) continue;

    const firstArg = positionalArgs[0];
    const argKind = firstArg.kind();

    // In Python AST, f-strings show up as "string" nodes starting with "f"
    // Plain string literals are "string" nodes not starting with "f"
    if (argKind === "string") {
      const text = firstArg.text();
      if (!text.startsWith("f\"") && !text.startsWith("f'")) {
        // It's a plain string literal — safe, don't flag
        continue;
      }
    } else if (argKind === "concatenated_string") {
      // Could be dynamic, flag it
    } else if (argKind !== "identifier" && argKind !== "binary_operator") {
      // Not a pattern we recognize as dynamic — skip to reduce false positives
      continue;
    }

    findings.push(
      makeFinding(
        "unsafe-shell-exec",
        ctx,
        call,
        `${calleeText}() called with shell=True and dynamic argument — risk of shell injection`,
        "error",
        "Pass arguments as a list and remove shell=True: subprocess.run(['cmd', arg])",
      ),
    );
  }

  return findings;
}

export const unsafeShellExec: Detector = {
  id: "unsafe-shell-exec",
  meta: {
    name: "Unsafe Shell Execution",
    description:
      "Detects shell command execution with dynamic arguments that may be vulnerable to injection",
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
