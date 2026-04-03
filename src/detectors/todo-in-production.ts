import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

const TODO_RE = /\b(TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\b/i;

// Keywords that escalate severity from info to warning
const SECURITY_KEYWORDS = /\b(auth\w*|secur\w*|encrypt\w*|decrypt\w*|credential\w*|password|token|secret|permiss\w*|access|inject\w*|sanitiz\w*|validat\w*|csrf|xss|sql|vuln\w*)\b/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const lines = ctx.source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(TODO_RE);
    if (!match) continue;

    // Check if this line is in a comment by looking for comment markers
    const trimmed = line.trimStart();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("#") ||
                      trimmed.startsWith("*") || trimmed.startsWith("/*");
    if (!isComment) continue;

    const hasSecurityImplication = SECURITY_KEYWORDS.test(line);

    findings.push(makeLineFinding(
      "todo-in-production",
      ctx,
      i + 1,
      (match.index ?? 0) + 1,
      `${match[1]} comment in production code${hasSecurityImplication ? " (security-related)" : ""}`,
      hasSecurityImplication ? "warning" : "info",
      "Address the TODO or create a tracked issue and reference it in the comment",
    ));
  }

  return findings;
}

export const todoInProduction: Detector = {
  id: "todo-in-production",
  meta: {
    name: "TODO in Production",
    description: "Detects TODO/FIXME/HACK comments in production code, especially security-related ones",
    severity: "info",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
