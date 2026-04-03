import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

const SENSITIVE_KEYS = /(?:token|jwt|auth|session|credential|secret|apikey|api_key|access_token|refresh_token|id_token|bearer)/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (ctx.file.language === "python") return findings;
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
    if (object.text() !== "localStorage" && object.text() !== "sessionStorage") continue;
    if (property.text() !== "setItem") continue;

    // Check if the key argument contains a sensitive name
    const args = children.find(ch => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args.children().filter(
      ch => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",",
    );
    if (argNodes.length === 0) continue;

    const keyArg = argNodes[0];
    if (!SENSITIVE_KEYS.test(keyArg.text())) continue;

    const storage = object.text();
    findings.push(makeFinding(
      "token-in-localstorage",
      ctx,
      call,
      `Auth token stored in ${storage} — vulnerable to XSS attacks`,
      "error",
      "Use httpOnly cookies for auth tokens instead of browser storage",
    ));
  }

  return findings;
}

export const tokenInLocalstorage: Detector = {
  id: "token-in-localstorage",
  meta: {
    name: "Token in LocalStorage",
    description: "Detects auth tokens stored in localStorage/sessionStorage where they're vulnerable to XSS",
    severity: "error",
    category: "security",
    languages: ["javascript", "typescript", "tsx"],
  },
  detect,
};
