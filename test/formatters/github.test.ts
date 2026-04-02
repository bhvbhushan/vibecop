import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGithub } from "../../src/formatters/github.js";
import type { Finding, ScanError, ScanResult } from "../../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    detectorId: "test-detector",
    message: "Test issue found",
    severity: "warning",
    file: "src/utils.ts",
    line: 3,
    column: 5,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    findings: [],
    filesScanned: 1,
    errors: [],
    ...overrides,
  };
}

describe("formatGithub", () => {
  let origSummary: string | undefined;

  beforeEach(() => {
    origSummary = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (origSummary === undefined) {
      delete process.env.GITHUB_STEP_SUMMARY;
    } else {
      process.env.GITHUB_STEP_SUMMARY = origSummary;
    }
  });

  test("produces ::error annotations for error findings", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          severity: "error",
          file: "src/auth.ts",
          line: 15,
          column: 1,
          detectorId: "insecure-defaults",
          message: "Hardcoded credential detected",
        }),
      ],
    });

    const output = formatGithub(result);
    expect(output).toContain("::error ");
    expect(output).toContain("file=src/auth.ts");
    expect(output).toContain("line=15");
    expect(output).toContain("col=1");
    expect(output).toContain("title=insecure-defaults");
    expect(output).toContain("::Hardcoded credential detected");
  });

  test("produces ::warning annotations for warning findings", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          severity: "warning",
          file: "src/utils.ts",
          line: 3,
          column: 5,
          detectorId: "empty-error-handler",
          message: "Catch block only logs the error without handling it",
        }),
      ],
    });

    const output = formatGithub(result);
    expect(output).toContain("::warning ");
    expect(output).toContain("file=src/utils.ts");
    expect(output).toContain("line=3");
    expect(output).toContain("col=5");
    expect(output).toContain("title=empty-error-handler");
    expect(output).toContain(
      "::Catch block only logs the error without handling it",
    );
  });

  test("produces ::notice annotations for info findings", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          severity: "info",
          file: "src/index.ts",
          line: 10,
          column: 1,
          detectorId: "todo-comment",
          message: "TODO comment found",
        }),
      ],
    });

    const output = formatGithub(result);
    expect(output).toContain("::notice ");
    expect(output).toContain("file=src/index.ts");
    expect(output).toContain("line=10");
    expect(output).toContain("col=1");
    expect(output).toContain("title=todo-comment");
    expect(output).toContain("::TODO comment found");
  });

  test("includes correct file, line, col, title attributes", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          severity: "error",
          file: "src/deep/nested/file.ts",
          line: 42,
          column: 17,
          detectorId: "some-rule-id",
          message: "Found an issue",
        }),
      ],
    });

    const output = formatGithub(result);
    const line = output.split("\n")[0];

    expect(line).toBe(
      "::error file=src/deep/nested/file.ts,line=42,col=17,title=some-rule-id::Found an issue",
    );
  });

  test("handles empty results", () => {
    const result = makeResult({ findings: [], errors: [] });
    const output = formatGithub(result);
    expect(output).toBe("");
  });

  test("outputs scan errors as ::warning annotations", () => {
    const scanError: ScanError = {
      file: "src/broken.ts",
      detectorId: "some-detector",
      message: "Failed to parse file",
    };
    const result = makeResult({
      findings: [],
      errors: [scanError],
    });

    const output = formatGithub(result);
    expect(output).toContain("::warning ");
    expect(output).toContain("file=src/broken.ts");
    expect(output).toContain("title=scan-error%3Asome-detector");
    expect(output).toContain("::Failed to parse file");
  });

  test("outputs scan errors without detectorId", () => {
    const scanError: ScanError = {
      file: "src/broken.ts",
      message: "Failed to parse file",
    };
    const result = makeResult({
      findings: [],
      errors: [scanError],
    });

    const output = formatGithub(result);
    expect(output).toContain("::warning ");
    expect(output).toContain("title=scan-error");
    expect(output).toContain("::Failed to parse file");
  });

  test("writes GITHUB_STEP_SUMMARY markdown", () => {
    const summaryFile = join(tmpdir(), `vibecop-test-summary-${Date.now()}.md`);
    writeFileSync(summaryFile, "");
    process.env.GITHUB_STEP_SUMMARY = summaryFile;

    try {
      const result = makeResult({
        findings: [
          makeFinding({
            severity: "error",
            file: "src/auth.ts",
            line: 15,
            column: 1,
            detectorId: "insecure-defaults",
            message: "Hardcoded credential detected",
          }),
          makeFinding({
            severity: "warning",
            file: "src/utils.ts",
            line: 3,
            column: 5,
            detectorId: "empty-error-handler",
            message: "Catch block only logs the error",
          }),
        ],
      });

      formatGithub(result);

      const content = readFileSync(summaryFile, "utf-8");

      // Check header
      expect(content).toContain("## vibecop Scan Results");

      // Check severity summary table
      expect(content).toContain("| Error | 1 |");
      expect(content).toContain("| Warning | 1 |");
      expect(content).toContain("| Info | 0 |");

      // Check findings table
      expect(content).toContain("### Findings");
      expect(content).toContain("| src/auth.ts | 15 | error | insecure-defaults | Hardcoded credential detected |");
      expect(content).toContain("| src/utils.ts | 3 | warning | empty-error-handler | Catch block only logs the error |");
    } finally {
      try {
        unlinkSync(summaryFile);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("does not write GITHUB_STEP_SUMMARY when env var is not set", () => {
    delete process.env.GITHUB_STEP_SUMMARY;

    const result = makeResult({
      findings: [makeFinding()],
    });

    // Should not throw even without the env var
    const output = formatGithub(result);
    expect(output).toBeTruthy();
  });

  test("handles multiple findings across files", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          severity: "error",
          file: "src/a.ts",
          line: 1,
          column: 1,
          detectorId: "rule-a",
          message: "Error A",
        }),
        makeFinding({
          severity: "warning",
          file: "src/b.ts",
          line: 2,
          column: 3,
          detectorId: "rule-b",
          message: "Warning B",
        }),
        makeFinding({
          severity: "info",
          file: "src/c.ts",
          line: 4,
          column: 5,
          detectorId: "rule-c",
          message: "Info C",
        }),
      ],
    });

    const output = formatGithub(result);
    const lines = output.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toStartWith("::error ");
    expect(lines[1]).toStartWith("::warning ");
    expect(lines[2]).toStartWith("::notice ");
  });
});
