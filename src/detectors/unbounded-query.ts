import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

// ORM methods that return multiple records and should have limits
const MULTI_RECORD_METHODS = new Set([
  "findMany", "findAll", "getMany",
]);

// Limit indicators in method chains
const LIMIT_INDICATORS = new Set([
  ".take(", ".limit(", ".top(", ".first(", ".skip(",
  ".paginate(", ".range(",
]);

// Known ORM/DB object prefixes that indicate a real database call
const ORM_PREFIXES = new Set([
  "prisma", "supabase", "db", "knex", "sequelize", "drizzle",
  "connection", "pool", "client", "repo", "repository",
  "Model", "model",
]);

/**
 * Check if the call expression looks like a DB/ORM call rather than
 * a plain array/object method. We require either:
 * - A member expression chain (obj.something.findMany()) — not a simple identifier
 * - The call text contains `.from(` before the method (Supabase pattern)
 * - The callee starts with a known ORM prefix
 */
function looksLikeDbCall(callText: string): boolean {
  // Supabase pattern: supabase.from(...).select(...)
  if (callText.includes(".from(")) return true;

  // Extract the part before the multi-record method call
  // e.g., "prisma.user.findMany({...})" -> "prisma.user"
  for (const method of MULTI_RECORD_METHODS) {
    const methodIdx = callText.indexOf(`.${method}(`);
    if (methodIdx === -1) continue;

    const prefix = callText.slice(0, methodIdx);

    // Must have at least one dot in the prefix (member expression chain)
    // e.g., "prisma.user" or "db.users" — not just "items"
    if (!prefix.includes(".")) {
      // Check if single identifier matches known ORM prefix
      const ident = prefix.trim();
      // PascalCase identifiers are likely Model classes (e.g., User.findAll())
      if (/^[A-Z][a-zA-Z0-9]+$/.test(ident)) return true;
      if (ORM_PREFIXES.has(ident)) return true;
      return false;
    }

    // Has a dot chain — check if root object is a known ORM prefix
    const rootObj = prefix.split(".")[0].trim();
    if (ORM_PREFIXES.has(rootObj)) return true;
    // PascalCase root (e.g., User.query().findAll())
    if (/^[A-Z][a-zA-Z0-9]+$/.test(rootObj)) return true;

    // Has a chain but unknown root — still more likely a DB call than array access
    return true;
  }

  return false;
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;
  const root = ctx.root.root();

  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const callText = call.text();

    let isMultiQuery = false;
    for (const method of MULTI_RECORD_METHODS) {
      if (callText.includes(`.${method}(`)) {
        isMultiQuery = true;
        break;
      }
    }
    if (!isMultiQuery) continue;

    // Skip if the call doesn't look like a DB/ORM call
    if (!looksLikeDbCall(callText)) continue;

    // Check if there's a limit in the call arguments or chain
    // For Prisma: findMany({ take: 10 })
    if (callText.includes("take:") || callText.includes("take :")) continue;

    // For Supabase/Knex: .findMany().limit(10)
    let hasLimit = false;
    for (const indicator of LIMIT_INDICATORS) {
      if (callText.includes(indicator)) {
        hasLimit = true;
        break;
      }
    }
    if (hasLimit) continue;

    // Check the broader expression context (parent chain might have .limit())
    let parent = call.parent();
    let chainHasLimit = false;
    while (parent && parent.kind() === "call_expression" || parent?.kind() === "member_expression") {
      const parentText = parent?.text() || "";
      for (const indicator of LIMIT_INDICATORS) {
        if (parentText.includes(indicator)) {
          chainHasLimit = true;
          break;
        }
      }
      if (chainHasLimit) break;
      parent = parent?.parent() ?? null;
    }
    if (chainHasLimit) continue;

    findings.push(makeFinding(
      "unbounded-query",
      ctx,
      call,
      "Query fetches multiple records without a limit — may return excessive data",
      "info",
      "Add a limit: findMany({ take: 100 }) or .limit(100)",
    ));
  }

  return findings;
}

export const unboundedQuery: Detector = {
  id: "unbounded-query",
  meta: {
    name: "Unbounded Query",
    description: "Detects database queries that fetch multiple records without a LIMIT clause",
    severity: "info",
    category: "quality",
    languages: ["javascript", "typescript", "tsx"],
  },
  detect(ctx: DetectionContext): Finding[] {
    return detectJavaScript(ctx);
  },
};
