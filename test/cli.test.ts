import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
const DIRTY_FIXTURES = join(import.meta.dir, "fixtures", "dirty");
const CLEAN_FIXTURES = join(import.meta.dir, "fixtures", "clean");

/** Run the CLI as a subprocess and capture output */
async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("CLI E2E", () => {
  test("vibecop scan on dirty fixtures produces output with findings", async () => {
    const { stdout, exitCode } = await runCli([
      "scan",
      DIRTY_FIXTURES,
      "--no-config",
    ]);

    // Should have output containing findings
    expect(stdout.length).toBeGreaterThan(0);
    // dirty fixtures should trigger detectors
    expect(stdout).toContain("problem");
    // Exit code 1 when findings exist
    expect(exitCode).toBe(1);
  });

  test("vibecop scan with --format json produces valid JSON", async () => {
    const { stdout, exitCode } = await runCli([
      "scan",
      DIRTY_FIXTURES,
      "--format",
      "json",
      "--no-config",
    ]);

    const parsed = JSON.parse(stdout);
    expect(parsed.findings).toBeDefined();
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total).toBeGreaterThan(0);
    expect(parsed.filesScanned).toBeGreaterThan(0);
    expect(exitCode).toBe(1);
  });

  test("exit code is 0 for clean directory", async () => {
    const { stdout, exitCode } = await runCli([
      "scan",
      CLEAN_FIXTURES,
      "--no-config",
    ]);

    expect(stdout).toContain("No problems found");
    expect(exitCode).toBe(0);
  });

  test("vibecop check on a single dirty file produces findings", async () => {
    const dirtyFile = join(DIRTY_FIXTURES, "bad-code.ts");
    const { stdout, exitCode } = await runCli(["check", dirtyFile]);

    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain("problem");
    expect(exitCode).toBe(1);
  });

  test("vibecop check on a single clean file produces no findings", async () => {
    const cleanFile = join(CLEAN_FIXTURES, "good-code.ts");
    const { stdout, exitCode } = await runCli(["check", cleanFile]);

    expect(stdout).toContain("No problems found");
    expect(exitCode).toBe(0);
  });

  test("vibecop scan with --verbose shows timing info", async () => {
    const { stdout } = await runCli([
      "scan",
      DIRTY_FIXTURES,
      "--verbose",
      "--no-config",
    ]);

    expect(stdout).toContain("Scan completed in");
    expect(stdout).toContain("ms");
  });

  test("vibecop --version outputs version", async () => {
    const { stdout } = await runCli(["--version"]);
    // Should output something like "0.1.0"
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("unsupported format shows error message", async () => {
    const { stderr, exitCode } = await runCli([
      "scan",
      DIRTY_FIXTURES,
      "--format",
      "csv",
      "--no-config",
    ]);

    expect(stderr).toContain("Unknown format");
    expect(exitCode).toBe(2);
  });

  test("html format produces HTML output", async () => {
    const { stdout, exitCode } = await runCli([
      "scan",
      DIRTY_FIXTURES,
      "--format",
      "html",
      "--no-config",
    ]);

    expect(stdout).toContain("<!DOCTYPE html>");
    expect(stdout).toContain("vibecop Report");
    // Dirty fixtures should produce findings
    expect(exitCode).toBe(1);
  });
});
