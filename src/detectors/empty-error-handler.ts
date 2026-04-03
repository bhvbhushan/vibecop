import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects catch/except blocks that do nothing useful:
 * - Completely empty catch blocks
 * - Catch blocks that only log (console.log/error/warn)
 * - Python except blocks with only `pass`
 *
 * NOT flagged:
 * - Catch blocks with explicit comments (intentionally empty)
 * - Catch blocks that re-throw
 * - Catch blocks with recovery logic (return, multiple statements)
 */

const CONSOLE_METHODS = new Set(["console.log", "console.error", "console.warn"]);

const PYTHON_LOG_FUNCTIONS = new Set(["print", "logging.debug", "logging.info", "logging.warning", "logging.error"]);

function isLogOnlyCall(nodeText: string): boolean {
  for (const method of CONSOLE_METHODS) {
    if (nodeText.startsWith(`${method}(`)) return true;
  }
  return false;
}

function isPythonLogOnlyCall(nodeText: string): boolean {
  for (const fn of PYTHON_LOG_FUNCTIONS) {
    if (nodeText.startsWith(`${fn}(`)) return true;
  }
  return false;
}

function detectJavaScriptCatchBlocks(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const catchClauses = root.findAll({ rule: { kind: "catch_clause" } });

  for (const catchNode of catchClauses) {
    const children = catchNode.children();
    const body = children.find((ch) => ch.kind() === "statement_block");
    if (!body) continue;

    // Get meaningful children (not braces)
    const bodyChildren = body.children().filter(
      (ch) => ch.kind() !== "{" && ch.kind() !== "}",
    );

    // If body has a comment, it's intentional — skip
    const hasComment = body.children().some((ch) => ch.kind() === "comment");
    if (hasComment) continue;

    if (bodyChildren.length === 0) {
      // Completely empty catch block
      findings.push(makeFinding(
        "empty-error-handler",
        ctx,
        catchNode,
        "Empty catch block silently swallows errors",
        "warning",
        "Add error handling, re-throw the error, or add a comment explaining why the error is intentionally ignored",
      ));
      continue;
    }

    // Check if the only statement is a console.log/error/warn call
    if (bodyChildren.length === 1) {
      const stmt = bodyChildren[0];
      if (stmt.kind() === "expression_statement") {
        const stmtText = stmt.text().replace(/;$/, "").trim();
        if (isLogOnlyCall(stmtText)) {
          findings.push(makeFinding(
            "empty-error-handler",
            ctx,
            catchNode,
            "Catch block only logs the error without handling it",
            "warning",
            "Add proper error handling: re-throw, return a fallback value, or propagate the error",
          ));
        }
      }
    }
  }

  return findings;
}

function detectPythonExceptBlocks(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  const exceptClauses = root.findAll({ rule: { kind: "except_clause" } });

  for (const exceptNode of exceptClauses) {
    const children = exceptNode.children();
    const block = children.find((ch) => ch.kind() === "block");
    if (!block) continue;

    const blockChildren = block.children();

    // Check for comment in the source text between except line and block content
    // Since Python comments don't appear as AST nodes inside blocks reliably,
    // we check the source text for the except clause region
    const exceptText = exceptNode.text();
    if (exceptText.includes("#")) continue;

    if (blockChildren.length === 1 && blockChildren[0].kind() === "pass_statement") {
      findings.push(makeFinding(
        "empty-error-handler",
        ctx,
        exceptNode,
        "Except block with only 'pass' silently swallows errors",
        "warning",
        "Add error handling, re-raise the exception, or add a comment explaining why the error is intentionally ignored",
      ));
      continue;
    }

    // Check for print-only except blocks
    if (blockChildren.length === 1 && blockChildren[0].kind() === "expression_statement") {
      const stmtText = blockChildren[0].text().trim();
      if (isPythonLogOnlyCall(stmtText)) {
        findings.push(makeFinding(
          "empty-error-handler",
          ctx,
          exceptNode,
          "Except block only logs the error without handling it",
          "warning",
          "Add proper error handling: re-raise, return a fallback value, or propagate the error",
        ));
      }
    }
  }

  return findings;
}

export const emptyErrorHandler: Detector = {
  id: "empty-error-handler",
  meta: {
    name: "Empty Error Handler",
    description:
      "Detects catch/except blocks that silently swallow errors without handling them",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") {
      return detectPythonExceptBlocks(ctx);
    }
    return detectJavaScriptCatchBlocks(ctx);
  },
};
