import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__|scripts)[\\/]|\.(?:test|spec|e2e)\.[^.]+$|[\\/]test_[^/\\]+\.py$|[\\/][^/\\]+_test\.py$)/i;

const DEBUG_METHODS = new Set(["log", "debug", "info", "dir", "table", "trace", "group", "groupEnd"]);

// Methods that are legitimate in production
const PROD_METHODS = new Set(["error", "warn"]);

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });

  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "member_expression") continue;

    const object = callee.children()[0];
    const property = callee.children().find(ch => ch.kind() === "property_identifier");
    if (!object || !property) continue;
    if (object.text() !== "console") continue;

    const method = property.text();
    if (!DEBUG_METHODS.has(method)) continue;

    findings.push(makeFinding(
      "debug-console-in-prod",
      ctx,
      call,
      `console.${method}() left in production code`,
      "warning",
      "Remove debug logging or replace with a structured logger",
    ));
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();
  const callExprs = root.findAll({ rule: { kind: "call" } });

  for (const call of callExprs) {
    const callText = call.text();
    if (!callText.startsWith("print(")) continue;

    findings.push(makeFinding(
      "debug-console-in-prod",
      ctx,
      call,
      "print() left in production code",
      "info",
      "Remove debug print or replace with logging module",
    ));
  }

  return findings;
}

export const debugConsoleInProd: Detector = {
  id: "debug-console-in-prod",
  meta: {
    name: "Debug Console in Production",
    description: "Detects console.log/print statements left in production code",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
