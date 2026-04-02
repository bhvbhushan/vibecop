import { describe, expect, test } from "bun:test";
import { buildActionSummary } from "../../src/action/summary.js";
import type { Finding, ScanResult } from "../../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    detectorId: "test-rule",
    message: "test message",
    severity: "warning",
    file: "test.ts",
    line: 1,
    column: 1,
    ...overrides,
  };
}

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    findings: [],
    filesScanned: 5,
    errors: [],
    ...overrides,
  };
}

describe("buildActionSummary", () => {
  test("shows no-issues message when no findings", () => {
    const result = makeResult({ findings: [] });
    const output = buildActionSummary(result, 0, [], 100);

    expect(output).toContain("No issues found");
    expect(output).toContain("Findings | 0");
  });

  test("shows metrics table with findings", () => {
    const findings = [
      makeFinding({ severity: "error" }),
      makeFinding({ severity: "warning" }),
      makeFinding({ severity: "info" }),
    ];
    const summaryOnly = [makeFinding({ severity: "warning", file: "other.ts", line: 42 })];
    const result = makeResult({ findings });

    const output = buildActionSummary(result, 2, summaryOnly, 150);

    expect(output).toContain("3 (1 errors, 1 warnings, 1 info)");
    expect(output).toContain("Inline comments | 2");
    expect(output).toContain("150ms");
    expect(output).toContain("Additional findings");
    expect(output).toContain("other.ts");
  });

  test("does not show summary-only section when empty", () => {
    const findings = [makeFinding({ severity: "error" })];
    const result = makeResult({ findings });

    const output = buildActionSummary(result, 1, [], 50);

    expect(output).not.toContain("Additional findings");
  });

  test("shows scan errors section when errors exist", () => {
    const result = makeResult({
      errors: [
        { file: "broken.ts", detectorId: "bad-detector", message: "Parse failed" },
      ],
    });

    const output = buildActionSummary(result, 0, [], 80);

    expect(output).toContain("Scan Errors");
    expect(output).toContain("Parse failed");
    expect(output).toContain("bad-detector");
  });

  test("does not show scan errors when none", () => {
    const result = makeResult({ errors: [] });

    const output = buildActionSummary(result, 0, [], 50);

    expect(output).not.toContain("Scan Errors");
  });

  test("includes vibecop attribution footer", () => {
    const result = makeResult();

    const output = buildActionSummary(result, 0, [], 50);

    expect(output).toContain('<sub>Scanned by <a href="https://github.com/bhvbhushan/vibecop">vibecop</a></sub>');
  });

  test("shows severity emojis in summary-only table", () => {
    const summaryOnly = [
      makeFinding({ severity: "error", file: "a.ts" }),
      makeFinding({ severity: "warning", file: "b.ts" }),
      makeFinding({ severity: "info", file: "c.ts" }),
    ];
    const result = makeResult({
      findings: [makeFinding({ severity: "error" })],
    });

    const output = buildActionSummary(result, 0, summaryOnly, 50);

    expect(output).toContain(":x:");
    expect(output).toContain(":warning:");
    expect(output).toContain(":information_source:");
  });
});
