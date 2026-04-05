import { describe, expect, test } from "bun:test";
import { formatGcc } from "../../src/formatters/gcc.js";
import type { Finding, ScanResult } from "../../src/types.js";

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

describe("formatGcc", () => {
  test("formats findings in gcc style", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          file: "src/app.ts",
          line: 42,
          column: 1,
          severity: "warning",
          message: "Test 'should work' has 8 assertions",
          detectorId: "assertion-roulette",
        }),
      ],
    });
    const output = formatGcc(result);
    expect(output).toContain(
      "src/app.ts:42:1: warning: Test 'should work' has 8 assertions [assertion-roulette]",
    );
  });

  test("outputs summary for zero findings", () => {
    const result = makeResult();
    const output = formatGcc(result);
    expect(output).toBe("0 findings");
  });

  test("shows correct severity levels", () => {
    const result = makeResult({
      findings: [
        makeFinding({ severity: "error", file: "a.ts", line: 1 }),
        makeFinding({ severity: "warning", file: "b.ts", line: 2 }),
        makeFinding({ severity: "info", file: "c.ts", line: 3 }),
      ],
    });
    const output = formatGcc(result);
    expect(output).toContain(": error:");
    expect(output).toContain(": warning:");
    expect(output).toContain(": info:");
    expect(output).toContain("3 findings in 3 files");
  });

  test("counts unique files in summary", () => {
    const result = makeResult({
      findings: [
        makeFinding({ file: "src/a.ts", line: 1 }),
        makeFinding({ file: "src/a.ts", line: 5 }),
        makeFinding({ file: "src/b.ts", line: 1 }),
      ],
    });
    const output = formatGcc(result);
    expect(output).toContain("3 findings in 2 files");
  });

  test("singular form for 1 finding in 1 file", () => {
    const result = makeResult({
      findings: [makeFinding()],
    });
    const output = formatGcc(result);
    expect(output).toContain("1 finding in 1 file");
  });
});
