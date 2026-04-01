import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { parse, Lang as SgLang, registerDynamicLanguage } from "@ast-grep/napi";
import type {
  AiqtConfig,
  DetectionContext,
  Detector,
  FileInfo,
  Lang,
  ProjectInfo,
  ScanError,
  ScanResult,
  TimingInfo,
} from "./types.js";

/** Map file extensions to Lang */
const EXTENSION_MAP: Record<string, Lang> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

/** Map Lang to ast-grep Lang enum. Python is a custom lang registered dynamically. */
const LANG_MAP: Record<Lang, SgLang | string> = {
  javascript: SgLang.JavaScript,
  typescript: SgLang.TypeScript,
  tsx: SgLang.Tsx,
  python: "python",
};

/** Register Python as a dynamic language for ast-grep. */
let pythonRegistered = false;

export function ensurePythonRegistered(): void {
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
    // Python support unavailable; Python files will fail to parse
    // but JS/TS files will still work fine.
  }
}

/** Default detector timeout in milliseconds */
const DETECTOR_TIMEOUT_MS = 5_000;

/**
 * Compile a glob pattern into a RegExp that can be tested efficiently.
 * Escapes regex-special characters and converts glob wildcards to regex syntax.
 */
function compileGlob(pattern: string): RegExp {
  // Mark ** and * before escaping other characters
  // Use unique placeholders that won't contain special regex characters
  let result = pattern
    .replace(/\*\*/g, "\x00GLOBSTAR\x00")  // Temporarily mark **
    .replace(/\*/g, "\x00STAR\x00")         // Temporarily mark *

  // Now escape all regex-special characters
  result = result
    .replace(/\\/g, "\\\\") // Backslash
    .replace(/\./g, "\\.")   // Dot
    .replace(/\?/g, "\\?")   // Question mark
    .replace(/\+/g, "\\+")   // Plus
    .replace(/\(/g, "\\(")   // Left paren
    .replace(/\)/g, "\\)")   // Right paren
    .replace(/\[/g, "\\[")   // Left bracket
    .replace(/\]/g, "\\]")   // Right bracket
    .replace(/\{/g, "\\{")   // Left brace
    .replace(/\}/g, "\\}")   // Right brace
    .replace(/\^/g, "\\^")   // Caret
    .replace(/\$/g, "\\$")   // Dollar
    .replace(/\|/g, "\\|");  // Pipe

  // Now replace marked wildcards with their regex equivalents
  const regexStr = result
    .replace(/\x00GLOBSTAR\x00/g, ".*")        // ** matches anything including /
    .replace(/\x00STAR\x00/g, "[^/]*");        // * matches anything except /

  return new RegExp(`^${regexStr}$`);
}

/**
 * Discover all supported files under `scanRoot`, respecting ignore patterns.
 */
export function discoverFiles(
  scanRoot: string,
  config: AiqtConfig,
): FileInfo[] {
  const root = resolve(scanRoot);
  const files: FileInfo[] = [];

  // Load .gitignore patterns
  const gitignorePatterns = loadGitignore(root);
  const allIgnorePatterns = [...config.ignore, ...gitignorePatterns];

  // Pre-compile all ignore patterns into RegExp objects
  const compiledIgnorePatterns = allIgnorePatterns.map(compileGlob);

  walkDirectory(root, root, compiledIgnorePatterns, files);

  return files;
}

/**
 * Run all detectors against discovered files.
 */
export function runDetectors(
  files: FileInfo[],
  detectors: Detector[],
  project: ProjectInfo,
  config: AiqtConfig,
  options: {
    verbose?: boolean;
    maxFindings?: number;
  } = {},
): ScanResult {
  const findings: ScanResult["findings"] = [];
  const errors: ScanError[] = [];
  const perDetector: Record<string, number> = {};
  const startTime = performance.now();
  let filesProcessed = 0;

  // Register Python if any Python files are in the scan set
  const hasPython = files.some((f) => f.language === "python");
  if (hasPython) {
    ensurePythonRegistered();
  }

  for (const file of files) {
    filesProcessed++;
    let source: string;
    try {
      source = readFileSync(file.absolutePath, "utf-8");
    } catch (err: unknown) {
      errors.push({
        file: file.path,
        message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Parse with ast-grep
    let root;
    try {
      const sgLang = LANG_MAP[file.language];
      root = parse(sgLang as SgLang, source);
    } catch (err: unknown) {
      errors.push({
        file: file.path,
        message: `Failed to parse file: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Run each detector against this file
    for (const detector of detectors) {
      // Check if detector supports this language
      if (!detector.meta.languages.includes(file.language)) {
        continue;
      }

      // Check if rule is disabled
      const ruleConfig = config.rules[detector.id] ?? {};
      if (ruleConfig.severity === "off") {
        continue;
      }

      const detectorStart = performance.now();

      try {
        const ctx: DetectionContext = {
          file,
          root,
          source,
          project,
          config: ruleConfig,
        };

        const result = runWithTimeout(
          () => detector.detect(ctx),
          DETECTOR_TIMEOUT_MS,
          detector.id,
          file.path,
        );

        if (result.timedOut) {
          errors.push({
            file: file.path,
            detectorId: detector.id,
            message: `Detector timed out after ${DETECTOR_TIMEOUT_MS}ms`,
          });
        } else if (result.error) {
          errors.push({
            file: file.path,
            detectorId: detector.id,
            message: result.error.message,
          });
        } else if (result.findings) {
          // Apply severity override from config
          // Note: "off" is already filtered above, so severityOverride here
          // is guaranteed to be "error" | "warning" | "info" | undefined
          const severityOverride = ruleConfig.severity as
            | "error"
            | "warning"
            | "info"
            | undefined;
          for (const finding of result.findings) {
            if (severityOverride) {
              finding.severity = severityOverride;
            }
            findings.push(finding);
          }
        }
      } catch (err: unknown) {
        // Detector isolation: catch any uncaught errors
        errors.push({
          file: file.path,
          detectorId: detector.id,
          message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (options.verbose) {
        const elapsed = performance.now() - detectorStart;
        perDetector[detector.id] =
          (perDetector[detector.id] ?? 0) + elapsed;
      }

      // Check max findings cap (0 = unlimited)
      if (
        options.maxFindings !== undefined &&
        options.maxFindings > 0 &&
        findings.length >= options.maxFindings
      ) {
        const totalMs = performance.now() - startTime;
        return {
          findings: findings.slice(0, options.maxFindings),
          filesScanned: filesProcessed,
          errors,
          timing: options.verbose
            ? { totalMs, perDetector }
            : undefined,
        };
      }
    }
  }

  const totalMs = performance.now() - startTime;
  const timing: TimingInfo | undefined = options.verbose
    ? { totalMs, perDetector }
    : undefined;

  return {
    findings,
    filesScanned: filesProcessed,
    errors,
    timing,
  };
}

/**
 * Run a detector function with a timeout.
 * Since JS is single-threaded, true preemption isn't possible,
 * but we track elapsed time and report timeouts after the fact.
 */
function runWithTimeout(
  fn: () => import("./types.js").Finding[],
  timeoutMs: number,
  detectorId: string,
  filePath: string,
): {
  findings?: import("./types.js").Finding[];
  error?: Error;
  timedOut: boolean;
} {
  const start = performance.now();
  try {
    const findings = fn();
    const elapsed = performance.now() - start;
    if (elapsed > timeoutMs) {
      console.warn(
        `Warning: Detector ${detectorId} took ${Math.round(elapsed)}ms on ${filePath} (exceeds ${timeoutMs}ms timeout)`,
      );
      return { timedOut: true };
    }
    return { findings, timedOut: false };
  } catch (err: unknown) {
    return {
      error: err instanceof Error ? err : new Error(String(err)),
      timedOut: false,
    };
  }
}

/**
 * Recursively walk a directory and collect supported files.
 */
function walkDirectory(
  dir: string,
  scanRoot: string,
  compiledIgnorePatterns: RegExp[],
  files: FileInfo[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if (isNodeError(err)) {
      if (err.code === "EACCES") {
        console.warn(`Warning: Permission denied, skipping directory: ${dir}`);
        return;
      }
      if (err.code === "ELOOP") {
        console.warn(`Warning: Symlink loop detected, skipping: ${dir}`);
        return;
      }
    }
    throw err;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(scanRoot, fullPath);

    // Check ignore patterns
    if (matchesIgnorePattern(relativePath, entry.name, compiledIgnorePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      // Skip hidden directories
      if (entry.name.startsWith(".")) continue;
      walkDirectory(fullPath, scanRoot, compiledIgnorePatterns, files);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // Check if symlink points to a valid file
      if (entry.isSymbolicLink()) {
        try {
          const stat = statSync(fullPath);
          if (!stat.isFile()) continue;
        } catch (err: unknown) {
          if (isNodeError(err) && err.code === "ELOOP") {
            console.warn(
              `Warning: Symlink loop detected, skipping: ${fullPath}`,
            );
          }
          continue;
        }
      }

      const ext = getExtension(entry.name);
      const language = EXTENSION_MAP[ext];
      if (!language) continue;

      // Skip binary files (simple heuristic: check first bytes)
      if (isBinaryFile(fullPath)) continue;

      files.push({
        path: relativePath,
        absolutePath: fullPath,
        language,
        extension: ext,
      });
    }
  }
}

/**
 * Check if a relative path matches any of the ignore patterns.
 * Supports basic glob patterns: **, *, and direct matches.
 */
function matchesIgnorePattern(
  relativePath: string,
  baseName: string,
  compiledPatterns: RegExp[],
): boolean {
  for (const regex of compiledPatterns) {
    if (regex.test(relativePath)) return true;
    if (regex.test(baseName)) return true;
  }
  return false;
}


/**
 * Load .gitignore patterns from the project root.
 */
function loadGitignore(root: string): string[] {
  const gitignorePath = join(root, ".gitignore");
  try {
    const content = readFileSync(gitignorePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        // Normalize: remove trailing slashes for directory patterns
        // and add ** for glob matching
        if (line.endsWith("/")) {
          return `${line}**`;
        }
        return line;
      });
  } catch {
    return [];
  }
}

/**
 * Get the file extension including the dot.
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot);
}

/**
 * Simple heuristic to detect binary files:
 * read the first 512 bytes and check for null bytes.
 */
function isBinaryFile(filePath: string): boolean {
  try {
    const fd = readFileSync(filePath, { encoding: null, flag: "r" });
    const sample = fd.subarray(0, 512);
    for (const byte of sample) {
      if (byte === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
