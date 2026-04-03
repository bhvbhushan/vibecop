import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

/**
 * Detects "god components" — React component files that do too much.
 *
 * Uses a file-level heuristic: counts useState, useEffect, and other hook calls
 * via regex, counts import statements via AST, and checks total line count.
 * Reports when 2+ thresholds are exceeded simultaneously.
 *
 * Only applies to .tsx files.
 */

/** Test file detection pattern */
const TEST_FILE_RE =
  /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

/** Check whether the source contains any JSX */
const JSX_RE = /<[A-Z][A-Za-z0-9.]*[\s/>]|<\/[A-Za-z]/;

interface GodComponentConfig {
  maxUseState: number;
  maxUseEffect: number;
  maxHooks: number;
  maxLines: number;
  maxImports: number;
}

const DEFAULTS: GodComponentConfig = {
  maxUseState: 5,
  maxUseEffect: 3,
  maxHooks: 10,
  maxLines: 300,
  maxImports: 15,
};

function detect(ctx: DetectionContext): Finding[] {
  // Only applies to .tsx files
  if (ctx.file.language !== "tsx") return [];

  // Skip test files
  if (TEST_FILE_RE.test(ctx.file.path)) return [];

  const { source } = ctx;

  // Skip files that don't contain any JSX
  if (!JSX_RE.test(source)) return [];

  // Resolve thresholds from config, falling back to defaults
  const cfg: GodComponentConfig = {
    maxUseState: (ctx.config.maxUseState as number) ?? DEFAULTS.maxUseState,
    maxUseEffect: (ctx.config.maxUseEffect as number) ?? DEFAULTS.maxUseEffect,
    maxHooks: (ctx.config.maxHooks as number) ?? DEFAULTS.maxHooks,
    maxLines: (ctx.config.maxLines as number) ?? DEFAULTS.maxLines,
    maxImports: (ctx.config.maxImports as number) ?? DEFAULTS.maxImports,
  };

  // --- Count hooks via regex ---
  const useStateCount = (source.match(/\buseState\s*[<(]/g) || []).length;
  const useEffectCount = (source.match(/\buseEffect\s*\(/g) || []).length;
  const useRefCount = (source.match(/\buseRef\s*[<(]/g) || []).length;
  const useMemoCount = (source.match(/\buseMemo\s*[<(]/g) || []).length;
  const useCallbackCount = (source.match(/\buseCallback\s*[<(]/g) || []).length;
  const useReducerCount = (source.match(/\buseReducer\s*[<(]/g) || []).length;

  const totalHooks =
    useStateCount +
    useEffectCount +
    useRefCount +
    useMemoCount +
    useCallbackCount +
    useReducerCount;

  // --- Count imports via AST ---
  const root = ctx.root.root();
  const importStatements = root.findAll({ rule: { kind: "import_statement" } });
  const importCount = importStatements.length;

  // --- Count total lines ---
  const lineCount = source.split("\n").length;

  // --- Determine which thresholds are exceeded ---
  const violations: string[] = [];

  if (useStateCount > cfg.maxUseState) {
    violations.push(`${useStateCount} useState`);
  }
  if (useEffectCount > cfg.maxUseEffect) {
    violations.push(`${useEffectCount} useEffect`);
  }
  if (totalHooks > cfg.maxHooks) {
    violations.push(`${totalHooks} total hooks`);
  }
  if (importCount > cfg.maxImports) {
    violations.push(`${importCount} imports`);
  }
  if (lineCount > cfg.maxLines) {
    violations.push(`${lineCount} lines`);
  }

  // Only report if 2+ thresholds are exceeded
  if (violations.length < 2) return [];

  return [
    makeLineFinding(
      "god-component",
      ctx,
      1,
      1,
      `Component file has too many hooks (${violations.join(", ")})`,
      "warning",
      "Split this component into smaller, focused components. Extract custom hooks for related state and effects.",
    ),
  ];
}

export const godComponent: Detector = {
  id: "god-component",
  meta: {
    name: "God Component",
    description:
      "Detects overly complex React components with too many hooks, imports, or lines of code",
    severity: "warning",
    category: "quality",
    languages: ["tsx"],
  },
  detect,
};
