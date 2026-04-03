import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

// UI framework imports
const UI_IMPORTS = new Set([
  "react", "react-dom", "next", "vue", "svelte",
  "@angular/core", "solid-js", "preact",
]);

// Database/ORM imports
const DB_IMPORTS = new Set([
  "@prisma/client", "prisma", "sequelize", "typeorm",
  "mongoose", "knex", "drizzle-orm", "better-sqlite3",
  "pg", "mysql2", "mongodb", "redis", "ioredis",
  "@supabase/supabase-js",
]);

// Server-only imports
const SERVER_IMPORTS = new Set([
  "express", "fastify", "koa", "hapi", "nest",
  "@nestjs/common", "child_process", "cluster",
]);

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (ctx.file.language === "python") return findings;
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  // Skip Next.js API routes and server components (they legitimately mix)
  if (ctx.file.path.includes("/api/")) return findings;
  if (ctx.file.path.includes("/server/")) return findings;
  // Skip if file has "use server" directive
  if (ctx.source.includes('"use server"') || ctx.source.includes("'use server'")) return findings;

  const root = ctx.root.root();
  const imports = root.findAll({ rule: { kind: "import_statement" } });

  let hasUIImport = false;
  let hasDBImport = false;
  let hasServerImport = false;
  let uiImportName = "";
  let dbImportName = "";

  for (const imp of imports) {
    const sourceNode = imp.children().find(ch => ch.kind() === "string");
    if (!sourceNode) continue;

    const specifier = sourceNode.text().slice(1, -1);
    const pkgName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];

    if (UI_IMPORTS.has(pkgName)) {
      hasUIImport = true;
      uiImportName = pkgName;
    }
    if (DB_IMPORTS.has(pkgName)) {
      hasDBImport = true;
      dbImportName = pkgName;
    }
    if (SERVER_IMPORTS.has(pkgName)) {
      hasServerImport = true;
    }
  }

  if (hasUIImport && hasDBImport) {
    findings.push(makeLineFinding(
      "mixed-concerns",
      ctx,
      1,
      1,
      `File imports both UI framework (${uiImportName}) and database (${dbImportName}) — mixed concerns`,
      "warning",
      "Separate UI rendering from data access. Move database logic to a service/API layer.",
    ));
  }

  if (hasUIImport && hasServerImport) {
    findings.push(makeLineFinding(
      "mixed-concerns",
      ctx,
      1,
      1,
      `File imports both UI framework (${uiImportName}) and server framework — mixed concerns`,
      "warning",
      "Separate UI components from server-side logic.",
    ));
  }

  return findings;
}

export const mixedConcerns: Detector = {
  id: "mixed-concerns",
  meta: {
    name: "Mixed Concerns",
    description: "Detects files that import from incompatible architectural layers (e.g., UI + database)",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx"],
  },
  detect,
};
