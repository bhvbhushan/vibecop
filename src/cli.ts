#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { builtinDetectors } from "./detectors/index.js";
import { discoverFiles, runDetectors } from "./engine.js";
import { getFormatter } from "./formatters/index.js";
import { loadProjectInfo } from "./project.js";
import type { AiqtConfig, FileInfo, Lang } from "./types.js";

/** Map file extensions to Lang (mirrors engine.ts) */
const EXTENSION_MAP: Record<string, Lang> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
};

/** Read version from package.json */
function getVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

/** Handle EPIPE errors on stdout to exit cleanly when piped to head/etc. */
function setupEpipeHandler(): void {
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") {
      process.exit(0);
    }
    throw err;
  });
}

/** Read file paths from stdin (one per line) */
async function readStdinFiles(): Promise<string[]> {
  return new Promise((resolvePromise) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      const files = data
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      resolvePromise(files);
    });
    // If stdin is a TTY (not piped), resolve immediately with empty
    if (process.stdin.isTTY) {
      resolvePromise([]);
    }
  });
}

/** Get changed files from git diff against a ref */
function getGitDiffFiles(ref: string, scanRoot: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${ref}`, {
      cwd: scanRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get git diff against '${ref}': ${message}`);
  }
}

/** Convert file paths to FileInfo objects, filtering to supported extensions */
function pathsToFileInfos(
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

/** Write output to stdout, handling EPIPE */
function writeOutput(text: string): void {
  try {
    process.stdout.write(`${text}\n`);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EPIPE"
    ) {
      process.exit(0);
    }
    throw err;
  }
}

interface ScanOptions {
  format: string;
  config?: string | false;
  maxFindings: string;
  verbose: boolean;
  diff?: string;
  stdinFiles?: boolean;
  groupBy: string;
}

interface CheckOptions {
  format: string;
  maxFindings: string;
  verbose: boolean;
  groupBy: string;
}

/** Execute the scan command */
async function scanAction(
  scanPath: string | undefined,
  options: ScanOptions,
): Promise<void> {
  const scanRoot = resolve(scanPath ?? ".");

  // Load config
  // Commander's --no-config sets options.config to false
  let config: AiqtConfig;
  if (options.config === false) {
    config = { ...DEFAULT_CONFIG };
  } else {
    config = loadConfig(options.config || undefined);
  }

  // Load project info
  const project = loadProjectInfo(scanRoot);

  // Discover files
  let files: FileInfo[];

  if (options.stdinFiles) {
    const stdinPaths = await readStdinFiles();
    files = pathsToFileInfos(stdinPaths, scanRoot);
  } else if (options.diff) {
    const diffPaths = getGitDiffFiles(options.diff, scanRoot);
    files = pathsToFileInfos(diffPaths, scanRoot);
  } else {
    files = discoverFiles(scanRoot, config);
  }

  // Run detectors
  const maxFindings = Number.parseInt(options.maxFindings, 10);
  const result = runDetectors(files, builtinDetectors, project, config, {
    verbose: options.verbose,
    maxFindings: Number.isNaN(maxFindings) ? 50 : maxFindings,
  });

  // Format and output
  const groupBy = options.groupBy === "rule" ? "rule" : "file";
  let formatter: (r: typeof result) => string;
  try {
    formatter = getFormatter(options.format, { groupBy });
  } catch (err: unknown) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  writeOutput(formatter(result));

  // Exit code: 1 if findings, 0 if clean
  process.exit(result.findings.length > 0 ? 1 : 0);
}

/** Execute the check command (single file) */
function checkAction(
  filePath: string,
  options: CheckOptions,
): void {
  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    process.stderr.write(`Error: File not found: ${filePath}\n`);
    process.exit(2);
  }

  const ext = extname(absolutePath);
  const language = EXTENSION_MAP[ext];
  if (!language) {
    process.stderr.write(
      `Error: Unsupported file type: ${ext}. Supported: ${Object.keys(EXTENSION_MAP).join(", ")}\n`,
    );
    process.exit(2);
  }

  const scanRoot = resolve(".");
  const fileInfo: FileInfo = {
    path: relative(scanRoot, absolutePath),
    absolutePath,
    language,
    extension: ext,
  };

  const config = { ...DEFAULT_CONFIG };
  const project = loadProjectInfo(scanRoot);
  const maxFindings = Number.parseInt(options.maxFindings, 10);

  const result = runDetectors([fileInfo], builtinDetectors, project, config, {
    verbose: options.verbose,
    maxFindings: Number.isNaN(maxFindings) ? 50 : maxFindings,
  });

  const groupBy = options.groupBy === "rule" ? "rule" : "file";
  let formatter: (r: typeof result) => string;
  try {
    formatter = getFormatter(options.format, { groupBy });
  } catch (err: unknown) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  writeOutput(formatter(result));
  process.exit(result.findings.length > 0 ? 1 : 0);
}

/** Build and run the CLI */
function main(): void {
  setupEpipeHandler();

  const program = new Command();

  program
    .name("aiqt")
    .description("AI code quality linter built on ast-grep")
    .version(getVersion());

  program
    .command("scan")
    .description("Scan a directory for code quality issues")
    .argument("[path]", "Directory to scan", ".")
    .option(
      "-f, --format <format>",
      "Output format (text, json, github, sarif, html)",
      "text",
    )
    .option("-c, --config <path>", "Path to config file")
    .option("--no-config", "Disable config file loading")
    .option(
      "--max-findings <number>",
      "Maximum number of findings to report",
      "50",
    )
    .option("--verbose", "Show timing information", false)
    .option("--diff <ref>", "Scan only files changed vs git ref")
    .option("--stdin-files", "Read file list from stdin", false)
    .option("--group-by <mode>", "Group findings by 'file' or 'rule'", "file")
    .action(scanAction);

  program
    .command("check")
    .description("Check a single file for code quality issues")
    .argument("<file>", "File to check")
    .option(
      "-f, --format <format>",
      "Output format (text, json, github, sarif, html)",
      "text",
    )
    .option(
      "--max-findings <number>",
      "Maximum number of findings to report",
      "50",
    )
    .option("--verbose", "Show timing information", false)
    .option("--group-by <mode>", "Group findings by 'file' or 'rule'", "file")
    .action(checkAction);

  program.parse();
}

main();
