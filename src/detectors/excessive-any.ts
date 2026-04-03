import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (ctx.file.language !== "typescript" && ctx.file.language !== "tsx") return findings;
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  // .d.ts files often legitimately use any
  if (ctx.file.path.endsWith(".d.ts")) return findings;

  const root = ctx.root.root();

  // Find type annotations that are just "any"
  // In the TypeScript AST, "any" as a type appears as a predefined_type node
  const typeAnnotations = root.findAll({ rule: { kind: "predefined_type" } });

  const anyLocations: Array<{ line: number; column: number; endLine: number; endColumn: number }> = [];

  for (const typeNode of typeAnnotations) {
    if (typeNode.text() !== "any") continue;
    const range = typeNode.range();
    anyLocations.push({
      line: range.start.line + 1,
      column: range.start.column + 1,
      endLine: range.end.line + 1,
      endColumn: range.end.column + 1,
    });
  }

  // Also catch any in regex for edge cases the AST might miss (like `as any`)
  const lines = ctx.source.split("\n");
  const anyRe = /:\s*any\b|<any>|\bas\s+any\b/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    let match: RegExpExecArray | null;
    anyRe.lastIndex = 0;
    while ((match = anyRe.exec(line)) !== null) {
      // Check if this location is already found by AST
      const alreadyFound = anyLocations.some(loc => loc.line === i + 1);
      if (!alreadyFound) {
        anyLocations.push({
          line: i + 1,
          column: match.index + 1,
          endLine: i + 1,
          endColumn: match.index + match[0].length + 1,
        });
      }
    }
  }

  // Only flag if file has more than 3 `any` usages (threshold)
  const threshold = (ctx.config as any)?.threshold ?? 3;
  if (anyLocations.length <= threshold) return findings;

  // Report each instance
  for (const loc of anyLocations) {
    findings.push(makeLineFinding(
      "excessive-any",
      ctx,
      loc.line,
      loc.column,
      `Excessive use of 'any' type (${anyLocations.length} in this file) — weakens type safety`,
      "warning",
      "Replace with a specific type, unknown, or a generic type parameter",
      loc.endLine,
      loc.endColumn,
    ));
  }

  return findings;
}

export const excessiveAny: Detector = {
  id: "excessive-any",
  meta: {
    name: "Excessive Any",
    description: "Detects files with excessive use of the 'any' type annotation in TypeScript",
    severity: "warning",
    category: "quality",
    languages: ["typescript", "tsx"],
  },
  detect,
};
