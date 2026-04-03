import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // 1. Identical if/else branches
  const ifStatements = root.findAll({ rule: { kind: "if_statement" } });
  for (const ifStmt of ifStatements) {
    const children = ifStmt.children();
    const consequent = children.find(ch => ch.kind() === "statement_block");
    const elseClause = children.find(ch => ch.kind() === "else_clause");
    if (!consequent || !elseClause) continue;

    const elseBody = elseClause.children().find(ch => ch.kind() === "statement_block");
    if (!elseBody) continue;

    // Compare the text of both branches (normalize whitespace)
    const ifText = consequent.text().replace(/\s+/g, " ").trim();
    const elseText = elseBody.text().replace(/\s+/g, " ").trim();

    if (ifText === elseText && ifText.length > 4) {  // Skip trivial blocks like {}
      findings.push(makeFinding(
        "dead-code-path",
        ctx,
        ifStmt,
        "if and else branches are identical — condition has no effect",
        "warning",
        "Remove the conditional and keep only the body, or fix the branch logic",
      ));
    }
  }

  // 2. Code after return/throw in a block
  const blocks = root.findAll({ rule: { kind: "statement_block" } });
  for (const block of blocks) {
    const stmts = block.children().filter(
      ch => ch.kind() !== "{" && ch.kind() !== "}" && ch.kind() !== "comment",
    );

    let foundTerminator = false;
    for (const stmt of stmts) {
      if (foundTerminator) {
        findings.push(makeFinding(
          "dead-code-path",
          ctx,
          stmt,
          "Unreachable code after return/throw statement",
          "warning",
          "Remove unreachable code or fix the control flow",
        ));
        break; // Only report once per block
      }
      if (stmt.kind() === "return_statement" || stmt.kind() === "throw_statement") {
        foundTerminator = true;
      }
    }
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // Identical if/else in Python
  const ifStatements = root.findAll({ rule: { kind: "if_statement" } });
  for (const ifStmt of ifStatements) {
    const children = ifStmt.children();
    const blocks = children.filter(ch => ch.kind() === "block");
    const elseClause = children.find(ch => ch.kind() === "else_clause");

    if (blocks.length >= 1 && elseClause) {
      const elseBlock = elseClause.children().find(ch => ch.kind() === "block");
      if (elseBlock) {
        const ifText = blocks[0].text().replace(/\s+/g, " ").trim();
        const elseText = elseBlock.text().replace(/\s+/g, " ").trim();

        if (ifText === elseText && ifText.length > 4) {
          findings.push(makeFinding(
            "dead-code-path",
            ctx,
            ifStmt,
            "if and else branches are identical — condition has no effect",
            "warning",
            "Remove the conditional and keep only the body, or fix the branch logic",
          ));
        }
      }
    }
  }

  return findings;
}

export const deadCodePath: Detector = {
  id: "dead-code-path",
  meta: {
    name: "Dead Code Path",
    description: "Detects dead code: identical if/else branches and unreachable code after return/throw",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
