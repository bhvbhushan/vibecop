import { parse, Lang as SgLang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { findImports, findFunctions, findClasses, findExports } from "../ast-utils.js";
import type { Lang } from "../types.js";

const EXTENSION_TO_LANG: Record<string, Lang> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

const LANG_TO_SG: Record<Lang, SgLang | string> = {
  javascript: SgLang.JavaScript,
  typescript: SgLang.TypeScript,
  tsx: SgLang.Tsx,
  python: "python",
};

let pythonRegistered = false;
function ensurePython(): void {
  if (pythonRegistered) return;
  try {
    const req = createRequire(import.meta.url);
    const pythonLang = req("@ast-grep/lang-python") as {
      libraryPath: string;
      extensions: string[];
      languageSymbol?: string;
      expandoChar?: string;
    };
    registerDynamicLanguage({ python: pythonLang });
    pythonRegistered = true;
  } catch {
    // Python support unavailable
  }
}

export function languageForExtension(ext: string): Lang | null {
  return EXTENSION_TO_LANG[ext] ?? null;
}

/**
 * Extract a structural skeleton from source code.
 * Returns a compact representation of imports, function signatures,
 * class outlines, and exports — without implementation bodies.
 *
 * Used by context optimization to provide Claude with file structure
 * on re-reads instead of full file content.
 */
export function extractSkeleton(source: string, language: Lang): string {
  if (language === "python") ensurePython();

  const sgLang = LANG_TO_SG[language];
  let root;
  try {
    root = parse(sgLang as SgLang, source).root();
  } catch {
    return fallbackSkeleton(source);
  }

  const lines: string[] = [];

  // Imports
  const imports = findImports(root, language);
  if (imports.length > 0) {
    for (const imp of imports) {
      lines.push(imp.text);
    }
    lines.push("");
  }

  // Classes with method signatures
  const classes = findClasses(root, language);
  for (const cls of classes) {
    if (language === "python") {
      lines.push(`class ${cls.name}:`);
    } else {
      lines.push(`class ${cls.name} {`);
    }
    for (const method of cls.methods) {
      lines.push(`  ${method}(...)`);
    }
    if (language !== "python") lines.push("}");
    lines.push("");
  }

  // Standalone functions (not inside classes)
  const functions = findFunctions(root, language);
  const classMethodNodes = new Set(
    classes.flatMap((cls) =>
      cls.node.findAll({ rule: { kind: language === "python" ? "function_definition" : "method_definition" } }),
    ).map((n) => n.range().start.line),
  );

  for (const fn of functions) {
    // Skip class methods (already shown above)
    if (classMethodNodes.has(fn.node.range().start.line)) continue;

    const range = fn.node.range();
    const sig = source.split("\n").slice(range.start.line, range.start.line + 1)[0]?.trim() ?? "";
    if (sig) lines.push(sig.replace(/\{[\s\S]*$/, "{ ... }"));
  }

  if (functions.length > 0 && classes.length === 0) lines.push("");

  // Exports (JS/TS only)
  const exports = findExports(root, language);
  for (const exp of exports) {
    if (exp.kind === "function" || exp.kind === "class") continue; // already shown
    lines.push(`export ${exp.kind === "default" ? "default" : ""} ${exp.name}`.trim());
  }

  const skeleton = lines.join("\n").trim();
  return skeleton || fallbackSkeleton(source);
}

/** Regex-based fallback when AST parsing fails. */
function fallbackSkeleton(source: string): string {
  const lines = source.split("\n");
  const skeleton: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("from ") ||
      trimmed.startsWith("export ") ||
      trimmed.startsWith("class ") ||
      /^(async\s+)?function\s/.test(trimmed) ||
      /^(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/.test(trimmed) ||
      /^def\s/.test(trimmed)
    ) {
      skeleton.push(trimmed);
    }
  }
  return skeleton.join("\n");
}
