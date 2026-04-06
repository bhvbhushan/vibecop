#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { scan, checkFile } from "./engine.js";
import { getFormatter } from "./formatters/index.js";
import type { ScanResult } from "./types.js";

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

/** Resolve file list for scan: stdin, git diff, or auto-discover */
async function resolveFiles(
  options: ScanOptions,
  scanRoot: string,
): Promise<string[] | undefined> {
  if (options.stdinFiles) {
    return readStdinFiles();
  }
  if (options.diff) {
    return getGitDiffFiles(options.diff, scanRoot);
  }
  return undefined;
}

/** Execute the scan command */
async function scanAction(
  scanPath: string | undefined,
  options: ScanOptions,
): Promise<void> {
  const scanRoot = resolve(scanPath ?? ".");
  const maxFindings = Number.parseInt(options.maxFindings, 10);
  const files = await resolveFiles(options, scanRoot);

  const result = await scan({
    scanPath: scanRoot,
    config: options.config,
    maxFindings: Number.isNaN(maxFindings) ? 50 : maxFindings,
    verbose: options.verbose,
    files,
  });

  formatAndExit(result, options.format, options.groupBy);
}

/** Execute the check command (single file) */
function checkAction(
  filePath: string,
  options: CheckOptions,
): void {
  const maxFindings = Number.parseInt(options.maxFindings, 10);

  let result: ScanResult;
  try {
    result = checkFile(filePath, {
      verbose: options.verbose,
      maxFindings: Number.isNaN(maxFindings) ? 50 : maxFindings,
    });
  } catch (err: unknown) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }

  formatAndExit(result, options.format, options.groupBy);
}

/** Format scan results and exit with appropriate code */
function formatAndExit(
  result: ScanResult,
  format: string,
  groupBy: string,
): never {
  const groupByMode = groupBy === "rule" ? "rule" : "file";
  let formatter: (r: ScanResult) => string;
  try {
    formatter = getFormatter(format, { groupBy: groupByMode });
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
    .command("serve")
    .description("Start MCP server (stdio transport)")
    .action(async () => {
      const { startServer } = await import("./mcp/index.js");
      await startServer();
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
