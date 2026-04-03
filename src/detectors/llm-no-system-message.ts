import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects LLM chat API calls where the messages array does not include
 * a system message (role: "system").
 *
 * Checks both JS object syntax { role: "system" } and Python dict syntax
 * {"role": "system"} inside messages array literals.
 */

const SYSTEM_ROLE_RE = /["']system["']/;

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Find all object properties named "messages" with array values
  const pairs = root.findAll({ rule: { kind: "pair" } });
  for (const pair of pairs) {
    const children = pair.children();
    const key = children.find(
      (ch) =>
        ch.kind() === "property_identifier" ||
        ch.kind() === "string" ||
        ch.kind() === "shorthand_property_identifier",
    );
    if (!key) continue;

    const keyName = key.text().replace(/["']/g, "");
    if (keyName !== "messages") continue;

    const value = children.find((ch) => ch.kind() === "array");
    if (!value) continue; // messages is a variable reference, can't statically analyze

    // Check if any object in the array has role: "system"
    const arrayText = value.text();
    if (!SYSTEM_ROLE_RE.test(arrayText)) {
      findings.push(
        makeFinding(
          "llm-no-system-message",
          ctx,
          pair,
          "messages array has no system message — LLM behavior may be unpredictable",
          "info",
          'Add a system message: { role: "system", content: "You are a helpful assistant." }',
        ),
      );
    }
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // In Python, look for keyword_argument with key "messages" and a list value
  const kwargs = root.findAll({ rule: { kind: "keyword_argument" } });
  for (const kwarg of kwargs) {
    const children = kwarg.children();
    const key = children.find((ch) => ch.kind() === "identifier");
    if (!key || key.text() !== "messages") continue;

    const value = children.find((ch) => ch.kind() === "list");
    if (!value) continue; // messages is a variable, can't analyze

    const listText = value.text();
    if (!SYSTEM_ROLE_RE.test(listText)) {
      findings.push(
        makeFinding(
          "llm-no-system-message",
          ctx,
          kwarg,
          "messages list has no system message — LLM behavior may be unpredictable",
          "info",
          'Add a system message: {"role": "system", "content": "You are a helpful assistant."}',
        ),
      );
    }
  }

  // Also check assignment: messages = [...]
  const assignments = root.findAll({ rule: { kind: "assignment" } });
  for (const assign of assignments) {
    const children = assign.children();
    const nameNode = children.find((ch) => ch.kind() === "identifier");
    if (!nameNode || nameNode.text() !== "messages") continue;

    const value = children.find((ch) => ch.kind() === "list");
    if (!value) continue;

    const listText = value.text();
    if (!SYSTEM_ROLE_RE.test(listText)) {
      findings.push(
        makeFinding(
          "llm-no-system-message",
          ctx,
          assign,
          "messages list has no system message — LLM behavior may be unpredictable",
          "info",
          'Add a system message: {"role": "system", "content": "You are a helpful assistant."}',
        ),
      );
    }
  }

  return findings;
}

export const llmNoSystemMessage: Detector = {
  id: "llm-no-system-message",
  meta: {
    name: "LLM No System Message",
    description:
      "Detects LLM chat API calls where messages array lacks a system role message",
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
