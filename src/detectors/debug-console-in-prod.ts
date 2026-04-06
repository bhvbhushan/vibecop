import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__|scripts)[\\/]|\.(?:test|spec|e2e)\.[^.]+$|[\\/]test_[^/\\]+\.py$|[\\/][^/\\]+_test\.py$)/i;

/** Files in CLI/server paths are expected to have console output */
const CLI_SERVER_RE = /(?:(?:^|[\\/])(?:scripts|bin|cli|server|daemon)[\\/]|[\\/](?:cli|server|main|index)\.[^.]+$)/i;

/**
 * Detect if the project is a CLI tool or server by checking for `bin` field
 * in the nearest package.json. CLI/server projects legitimately use console.log
 * for output — flagging it is noise.
 */
const binProjectCache = new Map<string, boolean>();
function isCliOrServerProject(filePath: string): boolean {
  let dir = dirname(filePath);
  if (binProjectCache.has(dir)) return binProjectCache.get(dir)!;

  const startDir = dir;
  while (dir.length > 1) {
    const pkgPath = join(dir, "package.json");
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const hasBin = pkg.bin !== undefined && pkg.bin !== null;
        binProjectCache.set(startDir, hasBin);
        return hasBin;
      }
    } catch { /* skip */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  binProjectCache.set(startDir, false);
  return false;
}

const DEFAULT_DEBUG_METHODS = new Set(["log", "debug"]);

/** Resolve which methods to flag: configurable via ctx.config.methods */
function resolveDebugMethods(ctx: DetectionContext): Set<string> {
  const configMethods = ctx.config.methods;
  if (Array.isArray(configMethods) && configMethods.length > 0) {
    return new Set(configMethods.filter((m): m is string => typeof m === "string"));
  }
  return DEFAULT_DEBUG_METHODS;
}

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;
  if (CLI_SERVER_RE.test(ctx.file.path)) return findings;
  if (isCliOrServerProject(ctx.file.absolutePath)) return findings;

  const debugMethods = resolveDebugMethods(ctx);
  const root = ctx.root.root();
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });

  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "member_expression") continue;

    const object = callee.children()[0];
    const property = callee.children().find(ch => ch.kind() === "property_identifier");
    if (!object || !property) continue;
    if (object.text() !== "console") continue;

    const method = property.text();
    if (!debugMethods.has(method)) continue;

    findings.push(makeFinding(
      "debug-console-in-prod",
      ctx,
      call,
      `console.${method}() left in production code`,
      "warning",
      "Remove debug logging or replace with a structured logger",
    ));
  }

  return findings;
}

function detectPython(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();
  const callExprs = root.findAll({ rule: { kind: "call" } });

  for (const call of callExprs) {
    const callText = call.text();
    if (!callText.startsWith("print(")) continue;

    findings.push(makeFinding(
      "debug-console-in-prod",
      ctx,
      call,
      "print() left in production code",
      "info",
      "Remove debug print or replace with logging module",
    ));
  }

  return findings;
}

export const debugConsoleInProd: Detector = {
  id: "debug-console-in-prod",
  meta: {
    name: "Debug Console in Production",
    description: "Detects console.log/print statements left in production code",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") return detectPython(ctx);
    return detectJavaScript(ctx);
  },
};
