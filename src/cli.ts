#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { loadCustomRules } from "./custom-rules.js";
import { builtinDetectors } from "./detectors/index.js";
import { EXTENSION_MAP, discoverFiles, pathsToFileInfos, runDetectors } from "./engine.js";
import { getFormatter } from "./formatters/index.js";
import { loadProjectInfo } from "./project.js";
import type { VibeCopConfig, FileInfo } from "./types.js";

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
  let config: VibeCopConfig;
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

  // Load custom rules and merge with builtins
  const customDetectors = loadCustomRules(
    resolve(scanRoot, config["custom-rules-dir"] ?? ".vibecop/rules"),
  );
  const allDetectors = [...builtinDetectors, ...customDetectors];

  // Run detectors
  const maxFindings = Number.parseInt(options.maxFindings, 10);
  const result = runDetectors(files, allDetectors, project, config, {
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

  const customDetectors = loadCustomRules(
    resolve(scanRoot, config["custom-rules-dir"] ?? ".vibecop/rules"),
  );
  const allDetectors = [...builtinDetectors, ...customDetectors];

  const result = runDetectors([fileInfo], allDetectors, project, config, {
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
    .name("vibecop")
    .description("AI code quality linter built on ast-grep")
    .version(getVersion());

  program
    .command("scan")
    .description("Scan a directory for code quality issues")
    .argument("[path]", "Directory to scan", ".")
    .option(
      "-f, --format <format>",
      "Output format (text, json, github, sarif, html, agent, gcc)",
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
      "Output format (text, json, github, sarif, html, agent, gcc)",
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

  program
    .command("init")
    .description("Set up vibecop integration with AI coding tools")
    .action(async () => {
      const { runInit } = await import("./init.js");
      await runInit();
    });

  program
    .command("test-rules")
    .description("Validate custom rules against their inline examples")
    .option(
      "--rules-dir <path>",
      "Path to custom rules directory",
      ".vibecop/rules",
    )
    .action(async (options: { rulesDir: string }) => {
      const { runTestRules } = await import("./test-rules.js");
      const result = runTestRules(resolve(options.rulesDir));
      process.exit(result.failed > 0 ? 1 : 0);
    });

  program.parse();
}

main();
