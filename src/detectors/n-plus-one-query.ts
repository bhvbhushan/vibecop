import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects database or API calls inside loops that may cause N+1 query
 * performance issues.
 *
 * Catches:
 * - ORM method calls inside for/for-of/for-in/while/do-while loops (JS/TS)
 * - Raw query/execute calls inside loops
 * - fetch() calls inside loops
 * - Python DB calls (SQLAlchemy, Django ORM, PyMongo) inside for/while loops
 *
 * NOT flagged:
 * - Calls outside loops
 * - Batched operations (Promise.all, WHERE IN, etc.)
 */

// Common DB/API call patterns
const JS_DB_METHODS = new Set([
  // ORM methods (Prisma, Sequelize, TypeORM, Knex, Drizzle)
  "findMany", "findFirst", "findUnique", "findOne", "findAll",
  "findOneBy", "findBy", "findAndCount",
  "create", "createMany", "update", "updateMany", "delete", "deleteMany",
  "upsert", "aggregate", "groupBy", "count",
  "save", "remove", "insert", "getOne", "getMany",
  // Raw query methods
  "query", "execute", "raw", "$queryRaw", "$executeRaw",
  // Supabase
  "rpc",
  // Mongoose
  "findById", "findByIdAndUpdate", "findByIdAndDelete",
  "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "countDocuments", "estimatedDocumentCount",
  "populate", "lean",
]);

const PY_DB_FUNCTIONS = new Set([
  "execute", "executemany", "fetchone", "fetchall", "fetchmany",
  "query", "scalar",
  "add", "merge", "delete", "commit", "flush",
  "find_one", "insert_one", "insert_many",
  "update_one", "update_many", "delete_one", "delete_many",
  "aggregate", "count_documents",
]);

const JS_NETWORK_FUNCTIONS = new Set(["fetch"]);

const JS_LOOP_KINDS = new Set([
  "for_statement", "for_in_statement", "for_of_statement",
  "while_statement", "do_statement",
]);

const PY_LOOP_KINDS = new Set(["for_statement", "while_statement"]);

function isInsideLoop(node: any, loopKinds: Set<string>): any | null {
  let parent = node.parent();
  while (parent) {
    if (loopKinds.has(parent.kind())) return parent;
    parent = parent.parent();
  }
  return null;
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Find all await expressions inside loops
  const awaitExprs = root.findAll({ rule: { kind: "await_expression" } });

  for (const awaitExpr of awaitExprs) {
    const loop = isInsideLoop(awaitExpr, JS_LOOP_KINDS);
    if (!loop) continue;

    // Check if the awaited expression is a DB/API call
    const awaitText = awaitExpr.text();

    // Check for method calls like db.query(), prisma.user.findMany(), supabase.from()
    let isDbCall = false;
    for (const method of JS_DB_METHODS) {
      if (awaitText.includes(`.${method}(`)) {
        isDbCall = true;
        break;
      }
    }

    // Check for fetch() calls
    if (!isDbCall) {
      for (const fn of JS_NETWORK_FUNCTIONS) {
        if (awaitText.includes(`${fn}(`)) {
          isDbCall = true;
          break;
        }
      }
    }

    if (!isDbCall) continue;

    findings.push(makeFinding(
      "n-plus-one-query",
      ctx,
      awaitExpr,
      "Database or API call inside a loop — potential N+1 query",
      "warning",
      "Batch the operation outside the loop (e.g., use WHERE IN, Promise.all, or bulk API endpoint)",
    ));
  }

  // Check for .map(async () => await db...) pattern — common N+1 disguised as batching
  // e.g., Promise.all(items.map(async (item) => { await db.find(...) }))
  const arrowFns = root.findAll({ rule: { kind: "arrow_function" } });
  for (const arrow of arrowFns) {
    // Check if this arrow is async
    const arrowText = arrow.text();
    if (!arrowText.startsWith("async")) continue;

    // Check if the arrow is inside a .map() call
    const parent = arrow.parent();
    if (!parent) continue;
    const grandParent = parent.parent();
    if (!grandParent || grandParent.kind() !== "call_expression") continue;
    const gpChildren = grandParent.children();
    const callee = gpChildren[0];
    if (!callee || callee.kind() !== "member_expression") continue;
    const prop = callee.children().find((ch: any) => ch.kind() === "property_identifier");
    if (!prop || (prop.text() !== "map" && prop.text() !== "forEach")) continue;

    // Now check if the arrow body contains await + DB/API calls
    const innerAwaits = arrow.findAll({ rule: { kind: "await_expression" } });
    for (const innerAwait of innerAwaits) {
      const innerText = innerAwait.text();
      let isDbCall = false;
      for (const method of JS_DB_METHODS) {
        if (innerText.includes(`.${method}(`)) { isDbCall = true; break; }
      }
      if (!isDbCall) {
        for (const fn of JS_NETWORK_FUNCTIONS) {
          if (innerText.includes(`${fn}(`)) { isDbCall = true; break; }
        }
      }
      if (!isDbCall) continue;

      findings.push(makeFinding(
        "n-plus-one-query",
        ctx,
        innerAwait,
        "Database or API call inside .map(async ...) — potential N+1 query",
        "warning",
        "Batch the operation (e.g., use WHERE IN or a single bulk query) instead of per-item async calls",
      ));
    }
  }

  // Also check for non-awaited calls (fire-and-forget or .then())
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const loop = isInsideLoop(call, JS_LOOP_KINDS);
    if (!loop) continue;

    // Skip if already inside an await (would be caught above)
    let parent = call.parent();
    let insideAwait = false;
    while (parent && parent !== loop) {
      if (parent.kind() === "await_expression") { insideAwait = true; break; }
      parent = parent.parent();
    }
    if (insideAwait) continue;

    const callText = call.text();
    let isDbCall = false;
    for (const method of JS_DB_METHODS) {
      if (callText.includes(`.${method}(`)) {
        isDbCall = true;
        break;
      }
    }
    for (const fn of JS_NETWORK_FUNCTIONS) {
      if (callText.includes(`${fn}(`)) {
        isDbCall = true;
        break;
      }
    }

    if (!isDbCall) continue;

    findings.push(makeFinding(
      "n-plus-one-query",
      ctx,
      call,
      "Database or API call inside a loop — potential N+1 query",
      "warning",
      "Batch the operation outside the loop (e.g., use WHERE IN, Promise.all, or bulk API endpoint)",
    ));
  }

  return findings;
}

function isDbCallPython(text: string): boolean {
  for (const fn of PY_DB_FUNCTIONS) {
    if (text.includes(`.${fn}(`) || text.startsWith(`${fn}(`)) return true;
  }
  return false;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();
  const reported = new Set<number>();

  // Check await expressions inside loops (async Python: `await db.execute(...)`)
  const awaitExprs = root.findAll({ rule: { kind: "await" } });
  for (const awaitExpr of awaitExprs) {
    const loop = isInsideLoop(awaitExpr, PY_LOOP_KINDS);
    if (!loop) continue;

    const awaitText = awaitExpr.text();
    if (!isDbCallPython(awaitText)) continue;

    const range = awaitExpr.range();
    reported.add(range.start.line);
    findings.push(makeFinding(
      "n-plus-one-query",
      ctx,
      awaitExpr,
      "Database call inside a loop — potential N+1 query",
      "warning",
      "Batch the operation outside the loop (e.g., use WHERE IN or bulk query)",
    ));
  }

  // Check regular calls inside loops (sync Python: `cursor.execute(...)`)
  const callExprs = root.findAll({ rule: { kind: "call" } });
  for (const call of callExprs) {
    const loop = isInsideLoop(call, PY_LOOP_KINDS);
    if (!loop) continue;

    // Skip if already reported via await
    const range = call.range();
    if (reported.has(range.start.line)) continue;

    const callText = call.text();
    if (!isDbCallPython(callText)) continue;

    findings.push(makeFinding(
      "n-plus-one-query",
      ctx,
      call,
      "Database call inside a loop — potential N+1 query",
      "warning",
      "Batch the operation outside the loop (e.g., use WHERE IN or bulk query)",
    ));
  }

  return findings;
}

export const nPlusOneQuery: Detector = {
  id: "n-plus-one-query",
  meta: {
    name: "N+1 Query",
    description: "Detects database or API calls inside loops that may cause N+1 query performance issues",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") {
      return detectPython(ctx);
    }
    return detectJavaScript(ctx);
  },
};
