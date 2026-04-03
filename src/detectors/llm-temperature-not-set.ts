import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects LLM API .create() calls that don't set a temperature parameter.
 * Without explicit temperature, the model uses its default which may vary.
 *
 * Checks both JS and Python patterns for completions/messages/chat .create() calls.
 */

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "member_expression") continue;

    const calleeText = callee.text();
    if (!calleeText.endsWith(".create")) continue;

    // Only check LLM-related create calls
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
    if (firstArg.kind() !== "object") continue;

    // Check if temperature property is present
    const pairs = firstArg.findAll({ rule: { kind: "pair" } });
    let hasTemperature = false;
    for (const pair of pairs) {
      const pairChildren = pair.children();
      const key = pairChildren.find(
        (ch) =>
          ch.kind() === "property_identifier" ||
          ch.kind() === "string" ||
          ch.kind() === "shorthand_property_identifier",
      );
      if (key && key.text().replace(/["']/g, "") === "temperature") {
        hasTemperature = true;
        break;
      }
    }

    // Also check shorthand properties
    if (!hasTemperature) {
      const shorthandProps = firstArg.findAll({ rule: { kind: "shorthand_property_identifier" } });
      for (const sp of shorthandProps) {
        if (sp.text() === "temperature") {
          hasTemperature = true;
          break;
        }
      }
    }

    if (!hasTemperature) {
      findings.push(
        makeFinding(
          "llm-temperature-not-set",
          ctx,
          call,
          ".create() called without temperature — model output randomness is not controlled",
          "info",
          "Set temperature explicitly: .create({ temperature: 0.7, ... })",
        ),
      );
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

    // Check for temperature keyword argument
    const kwargs = argList
      .children()
      .filter((ch) => ch.kind() === "keyword_argument");
    let hasTemperature = false;
    for (const kwarg of kwargs) {
      const kwChildren = kwarg.children();
      const key = kwChildren.find((ch) => ch.kind() === "identifier");
      if (key && key.text() === "temperature") {
        hasTemperature = true;
        break;
      }
    }

    if (!hasTemperature) {
      findings.push(
        makeFinding(
          "llm-temperature-not-set",
          ctx,
          call,
          `${calleeText}() called without temperature — model output randomness is not controlled`,
          "info",
          "Set temperature explicitly: .create(temperature=0.7, ...)",
        ),
      );
    }
  }

  return findings;
}

export const llmTemperatureNotSet: Detector = {
  id: "llm-temperature-not-set",
  meta: {
    name: "LLM Temperature Not Set",
    description:
      "Detects LLM API .create() calls without explicit temperature parameter",
    severity: "info",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
    priority: 10,
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
