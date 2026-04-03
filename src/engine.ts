import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve } from "node:path";
import { parse, Lang as SgLang, registerDynamicLanguage } from "@ast-grep/napi";
import type {
  VibeCopConfig,
  DetectionContext,
  Detector,
  FileInfo,
  Finding,
  Lang,
  ProjectInfo,
  ScanError,
  ScanResult,
  TimingInfo,
} from "./types.js";

/** Map file extensions to Lang */
export const EXTENSION_MAP: Record<string, Lang> = {
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
 *
 * Globstar matches zero or more path segments (including separators).
 * Single star matches any characters within a single path segment (no slash).
 */
function compileGlob(pattern: string): RegExp {
  // Tokenize pattern into literal segments and wildcards
  const tokens: Array<{ type: "literal" | "globstar" | "star"; value: string }> = [];
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      tokens.push({ type: "globstar", value: "**" });
      i += 2;
    } else if (pattern[i] === "*") {
      tokens.push({ type: "star", value: "*" });
      i += 1;
    } else {
      // Accumulate literal characters
      let lit = "";
      while (i < pattern.length && pattern[i] !== "*") {
        lit += pattern[i];
        i += 1;
      }
      tokens.push({ type: "literal", value: lit });
    }
  }

  // Build regex parts from tokens
  const regexParts: string[] = [];
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    if (token.type === "literal") {
      // Escape regex-special characters
      regexParts.push(
        token.value.replace(/[\\^$.|?+()[\]{}]/g, "\\$&"),
      );
    } else if (token.type === "star") {
      regexParts.push("[^/]*");
    } else {
      // globstar: absorb surrounding slashes to allow matching zero segments
      // Check if previous part ends with / and next part starts with /
      const prev = regexParts.length > 0 ? regexParts[regexParts.length - 1] : null;
      const next = t + 1 < tokens.length ? tokens[t + 1] : null;

      const prevHasSlash = prev !== null && prev.endsWith("\\/");
      const nextHasSlash = next !== null && next.type === "literal" && next.value.startsWith("/");

      if (prev === null && nextHasSlash) {
        // Leading: **/rest → match "" or "anything/" prefix
        // Remove leading / from next token
        tokens[t + 1] = { ...next!, value: next!.value.slice(1) };
        regexParts.push("(.+\\/)?");
      } else if (prevHasSlash && (next === null || (next.type === "literal" && next.value === ""))) {
        // Trailing: prefix/** → match "" or "/anything" suffix
        // Remove trailing / from prev
        regexParts[regexParts.length - 1] = prev!.slice(0, -2);
        regexParts.push("(\\/.*)?");
      } else if (prevHasSlash && nextHasSlash) {
        // Middle: prefix/**/rest → match "/" or "/anything/"
        // Remove trailing / from prev and leading / from next
        regexParts[regexParts.length - 1] = prev!.slice(0, -2);
        tokens[t + 1] = { ...next!, value: next!.value.slice(1) };
        regexParts.push("(\\/.*)?\\/" );
      } else {
        // Standalone ** without slashes — match anything
        regexParts.push(".*");
      }
    }
  }

  return new RegExp(`^${regexParts.join("")}$`);
}

/**
 * Discover all supported files under `scanRoot`, respecting ignore patterns.
 */
export function discoverFiles(
  scanRoot: string,
  config: VibeCopConfig,
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
  config: VibeCopConfig,
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

  const dedupedFindings = dedupFindings(findings, detectors);

  return {
    findings: dedupedFindings,
    filesScanned: filesProcessed,
    errors,
    timing,
  };
}

/**
 * Deduplicate findings that occur on the same file:line.
 * When multiple detectors flag the same location, keep only the
 * finding from the detector with the highest priority.
 */
export function dedupFindings(
  findings: Finding[],
  detectors: Detector[],
): Finding[] {
  // Build priority map from detector metadata
  const priorityMap = new Map<string, number>();
  for (const d of detectors) {
    priorityMap.set(d.id, d.meta.priority ?? 0);
  }

  // Group by file:line
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.file}:${f.line}`;
    const group = groups.get(key);
    if (group) {
      group.push(f);
    } else {
      groups.set(key, [f]);
    }
  }

  // Keep highest priority finding per location
  const deduped: Finding[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
    } else {
      group.sort((a, b) => {
        const pa = priorityMap.get(a.detectorId) ?? 0;
        const pb = priorityMap.get(b.detectorId) ?? 0;
        return pb - pa; // highest priority first
      });
      deduped.push(group[0]);
    }
  }

  return deduped;
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
        // Strip leading slash — gitignore uses it to mean "root-relative"
        // but our glob matcher works on relative paths from scan root
        if (line.startsWith("/")) {
          line = line.slice(1);
        }
        // Directory patterns: ensure they match recursively
        if (line.endsWith("/")) {
          return `**/${line}**`;
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

/**
 * Convert file paths to FileInfo objects, filtering to supported extensions.
 * Shared between CLI and GitHub Action.
 */
export function pathsToFileInfos(
  paths: string[],
  scanRoot: string,
): FileInfo[] {
  const resolvedRoot = resolve(scanRoot);
  const files: FileInfo[] = [];

  for (const filePath of paths) {
    const absolutePath = resolve(resolvedRoot, filePath);
    if (!existsSync(absolutePath)) continue;

    try {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    const ext = extname(absolutePath);
    const language = EXTENSION_MAP[ext];
    if (!language) continue;

    files.push({
      path: relative(resolvedRoot, absolutePath),
      absolutePath,
      language,
      extension: ext,
    });
  }

  return files;
}

const TEST_FILE_PATTERN = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
