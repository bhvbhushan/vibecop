import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects LLM API calls without timeout or max_tokens:
 * - JS: new OpenAI()/new Anthropic() without timeout in constructor options
 * - JS: .create() calls without max_tokens
 * - Python: .create() calls without timeout keyword argument
 */

const LLM_CONSTRUCTORS = new Set(["OpenAI", "Anthropic"]);

function hasProperty(objectNode: ReturnType<import("@ast-grep/napi").SgRoot["root"]>, propName: string): boolean {
  // Look for a pair/property with the given name inside an object
  const pairs = objectNode.findAll({ rule: { kind: "pair" } });
  for (const pair of pairs) {
    const children = pair.children();
    const key = children.find(
      (ch) => ch.kind() === "property_identifier" || ch.kind() === "string" || ch.kind() === "shorthand_property_identifier",
    );
    if (key && key.text().replace(/["']/g, "") === propName) {
      return true;
    }
  }
  // Also check shorthand properties
  const shorthandProps = objectNode.findAll({ rule: { kind: "shorthand_property_identifier" } });
  for (const sp of shorthandProps) {
    if (sp.text() === propName) return true;
  }
  return false;
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // 1. Check new OpenAI() / new Anthropic() for timeout
  const newExprs = root.findAll({ rule: { kind: "new_expression" } });
  for (const newExpr of newExprs) {
    const children = newExpr.children();
    const constructorNode = children.find((ch) => ch.kind() === "identifier");
    if (!constructorNode || !LLM_CONSTRUCTORS.has(constructorNode.text())) continue;

    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) {
      // new OpenAI() with no args at all
      findings.push(
        makeFinding(
          "llm-call-no-timeout",
          ctx,
          newExpr,
          `new ${constructorNode.text()}() called without timeout option`,
          "warning",
          `Pass a timeout option: new ${constructorNode.text()}({ timeout: 30000 })`,
        ),
      );
      continue;
    }

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");

    if (argNodes.length === 0) {
      // new OpenAI() with empty args
      findings.push(
        makeFinding(
          "llm-call-no-timeout",
          ctx,
          newExpr,
          `new ${constructorNode.text()}() called without timeout option`,
          "warning",
          `Pass a timeout option: new ${constructorNode.text()}({ timeout: 30000 })`,
        ),
      );
      continue;
    }

    const firstArg = argNodes[0];
    if (firstArg.kind() === "object") {
      if (!hasProperty(firstArg, "timeout")) {
        findings.push(
          makeFinding(
            "llm-call-no-timeout",
            ctx,
            newExpr,
            `new ${constructorNode.text()}() called without timeout option`,
            "warning",
            `Add timeout to options: new ${constructorNode.text()}({ timeout: 30000, ... })`,
          ),
        );
      }
    }
  }

  // 2. Check .create() calls for max_tokens
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "member_expression") continue;

    const calleeText = callee.text();
    if (!calleeText.endsWith(".create")) continue;

    // Check if this looks like an LLM API call (completions.create, messages.create, etc.)
    if (
      !calleeText.includes("completions") &&
      !calleeText.includes("messages") &&
      !calleeText.includes("chat")
    ) {
      continue;
    }

    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];
    if (firstArg.kind() === "object") {
      if (!hasProperty(firstArg, "max_tokens")) {
        findings.push(
          makeFinding(
            "llm-call-no-timeout",
            ctx,
            call,
            ".create() called without max_tokens — response size is unbounded",
            "warning",
            "Add max_tokens to limit response size: .create({ max_tokens: 1000, ... })",
          ),
        );
      }
    }
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

    const calleeText = callee.text();
    // Match patterns like:
    // openai.ChatCompletion.create()
    // client.chat.completions.create()
    // client.messages.create()
    if (!calleeText.endsWith(".create")) continue;
    if (
      !calleeText.includes("completions") &&
      !calleeText.includes("Completion") &&
      !calleeText.includes("messages") &&
      !calleeText.includes("chat")
    ) {
      continue;
    }

    const argList = children.find((ch) => ch.kind() === "argument_list");
    if (!argList) continue;

    // Check for timeout keyword argument
    const kwargs = argList
      .children()
      .filter((ch) => ch.kind() === "keyword_argument");
    let hasTimeout = false;
    for (const kwarg of kwargs) {
      const kwChildren = kwarg.children();
      const key = kwChildren.find((ch) => ch.kind() === "identifier");
      if (key && key.text() === "timeout") {
        hasTimeout = true;
        break;
      }
    }

    if (!hasTimeout) {
      findings.push(
        makeFinding(
          "llm-call-no-timeout",
          ctx,
          call,
          `${calleeText}() called without timeout — request may hang indefinitely`,
          "warning",
          "Add a timeout parameter: .create(timeout=30, ...)",
        ),
      );
    }
  }

  return findings;
}

export const llmCallNoTimeout: Detector = {
  id: "llm-call-no-timeout",
  meta: {
    name: "LLM Call No Timeout",
    description:
      "Detects LLM API calls (OpenAI, Anthropic) without timeout or max_tokens configuration",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
    priority: 10,
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
