import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

// Methods that mutate data and whose result should be checked
const MUTATION_METHODS = new Set([
  "insert", "insertMany", "insertOne",
  "update", "updateMany", "updateOne", "upsert",
  "delete", "deleteMany", "deleteOne",
  "create", "createMany",
  "save", "remove",
  "findByIdAndUpdate", "findByIdAndDelete",
  "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "$executeRaw", "$executeRawUnsafe",
]);

// Require DB-like context: chain patterns that indicate ORM/DB usage
// e.g., supabase.from("x").delete(), prisma.user.delete(), db.collection.insertOne()
const DB_CHAIN_INDICATORS = [
  ".from(", ".table(", ".collection(", ".model(",
  "prisma.", "supabase.", "knex.", "drizzle.",
  "db.", "database.", "mongo.", "client.",
  "$queryRaw", "$executeRaw",
];

function looksLikeDbCall(text: string): boolean {
  for (const indicator of DB_CHAIN_INDICATORS) {
    if (text.includes(indicator)) return true;
  }
  return false;
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();

  // Find expression statements that are bare await calls (result not stored)
  const exprStatements = root.findAll({ rule: { kind: "expression_statement" } });

  for (const stmt of exprStatements) {
    const children = stmt.children();
    // Look for: `await db.insert(...)` as a standalone expression (no assignment)
    const firstChild = children[0];
    if (!firstChild) continue;

    let callText: string;
    if (firstChild.kind() === "await_expression") {
      callText = firstChild.text();
    } else if (firstChild.kind() === "call_expression") {
      callText = firstChild.text();
    } else {
      continue;
    }

    let isMutation = false;
    for (const method of MUTATION_METHODS) {
      if (callText.includes(`.${method}(`)) {
        isMutation = true;
        break;
      }
    }
    if (!isMutation) continue;

    // Require DB-like chain to avoid false positives on Set.delete(), Map.delete(), etc.
    if (!looksLikeDbCall(callText)) continue;

    findings.push(makeFinding(
      "unchecked-db-result",
      ctx,
      stmt,
      "Database mutation result is not checked — errors will be silently ignored",
      "warning",
      "Store the result and check for errors: const result = await db.insert(...)",
    ));
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();
  const exprStatements = root.findAll({ rule: { kind: "expression_statement" } });

  const pyMutations = new Set([
    "execute", "executemany", "add", "merge", "delete",
    "insert_one", "insert_many", "update_one", "update_many",
    "delete_one", "delete_many", "replace_one",
    "commit", "flush",
  ]);

  for (const stmt of exprStatements) {
    const children = stmt.children();
    const firstChild = children[0];
    if (!firstChild) continue;

    // Look for bare calls and awaits
    let callText: string;
    if (firstChild.kind() === "await" || firstChild.kind() === "await_expression") {
      callText = firstChild.text();
    } else if (firstChild.kind() === "call") {
      callText = firstChild.text();
    } else {
      continue;
    }

    let isMutation = false;
    for (const method of pyMutations) {
      if (callText.includes(`.${method}(`)) {
        isMutation = true;
        break;
      }
    }
    if (!isMutation) continue;

    findings.push(makeFinding(
      "unchecked-db-result",
      ctx,
      stmt,
      "Database mutation result is not checked — errors may be silently ignored",
      "warning",
      "Store the result and verify the operation succeeded",
    ));
  }

  return findings;
}

export const uncheckedDbResult: Detector = {
  id: "unchecked-db-result",
  meta: {
    name: "Unchecked DB Result",
    description: "Detects database mutation calls whose results are not checked for errors",
    severity: "warning",
    category: "correctness",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
