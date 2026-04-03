import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

// Methods that execute SQL
const SQL_METHODS = new Set([
  "query", "execute", "raw", "$queryRaw", "$queryRawUnsafe",
  "$executeRaw", "$executeRawUnsafe", "prepare",
  "rawQuery", "sequelize.query",
]);

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;
  const root = ctx.root.root();

  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee) continue;

    // Check if this is a SQL method call
    const calleeText = callee.text();
    let isSqlMethod = false;
    for (const method of SQL_METHODS) {
      if (calleeText.endsWith(`.${method}`) || calleeText === method) {
        isSqlMethod = true;
        break;
      }
    }
    // Also match Prisma tagged template: prisma.$queryRaw`...`
    if (!isSqlMethod && call.kind() === "call_expression") {
      // Check for tagged template expression parent
      continue;
    }
    if (!isSqlMethod) continue;

    // Check arguments for template_string (template literal with expressions)
    const args = children.find(ch => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args.children().filter(
      ch => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ","
    );
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];

    // Template literal with interpolation: `SELECT * FROM ${table}`
    if (firstArg.kind() === "template_string") {
      // Check if it has template substitutions (${...})
      const hasSubstitution = firstArg.children().some(
        ch => ch.kind() === "template_substitution"
      );
      if (hasSubstitution) {
        findings.push(makeFinding(
          "sql-injection",
          ctx,
          call,
          "SQL query uses template literal with interpolation — potential SQL injection",
          "error",
          "Use parameterized queries instead: db.query('SELECT * FROM users WHERE id = $1', [userId])",
        ));
      }
    }

    // String concatenation: "SELECT * FROM " + table
    if (firstArg.kind() === "binary_expression") {
      const text = firstArg.text();
      // Check if it contains SQL keywords
      if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|DROP|ALTER|CREATE)\b/i.test(text)) {
        findings.push(makeFinding(
          "sql-injection",
          ctx,
          call,
          "SQL query built with string concatenation — potential SQL injection",
          "error",
          "Use parameterized queries instead of string concatenation",
        ));
      }
    }
  }

  // Also check tagged template literals: sql`SELECT * FROM ${table}`
  // These are actually SAFE (Prisma, slonik use them for parameterization)
  // So we should NOT flag tagged templates — only raw template strings in query() calls

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;
  const root = ctx.root.root();

  const calls = root.findAll({ rule: { kind: "call" } });
  for (const call of calls) {
    const callText = call.text();
    // Check for .execute() or .query() with f-string or format
    if (!callText.includes(".execute(") && !callText.includes(".query(")) continue;

    const children = call.children();
    const argList = children.find(ch => ch.kind() === "argument_list");
    if (!argList) continue;

    const args = argList.children().filter(
      ch => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ","
    );
    if (args.length === 0) continue;

    const firstArg = args[0];

    // f-string: f"SELECT * FROM {table}"
    if (firstArg.kind() === "string" && firstArg.text().startsWith("f")) {
      findings.push(makeFinding(
        "sql-injection",
        ctx,
        call,
        "SQL query uses f-string — potential SQL injection",
        "error",
        "Use parameterized queries: cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))",
      ));
    }

    // .format(): "SELECT ... {}".format(table)
    if (firstArg.kind() === "call" && firstArg.text().includes(".format(")) {
      const text = firstArg.text();
      if (/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(text)) {
        findings.push(makeFinding(
          "sql-injection",
          ctx,
          call,
          "SQL query uses .format() — potential SQL injection",
          "error",
          "Use parameterized queries instead of .format()",
        ));
      }
    }

    // % formatting: "SELECT ... %s" % (table,)
    if (firstArg.kind() === "binary_expression" ||
        (firstArg.kind() === "string" && args.length >= 2)) {
      // Check parent for % operator
      const stmtText = call.text();
      if (stmtText.includes(" % ") && /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i.test(stmtText)) {
        findings.push(makeFinding(
          "sql-injection",
          ctx,
          call,
          "SQL query uses % formatting — potential SQL injection",
          "error",
          "Use parameterized queries: cursor.execute('SELECT ... WHERE id = %s', (value,))",
        ));
      }
    }
  }

  return findings;
}

export const sqlInjection: Detector = {
  id: "sql-injection",
  meta: {
    name: "SQL Injection",
    description: "Detects SQL queries built with string interpolation or concatenation",
    severity: "error",
    category: "security",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
