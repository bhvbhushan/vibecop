import { describe, expect, test } from "bun:test";
import { formatSarif } from "../../src/formatters/sarif.js";
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

describe("formatSarif", () => {
  test("outputs valid JSON", () => {
    const result = makeResult({
      findings: [makeFinding()],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe("object");
  });

  test("has correct $schema and version", () => {
    const result = makeResult({ findings: [] });
    const output = formatSarif(result);
    const parsed = JSON.parse(output);

    expect(parsed.$schema).toBe(
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    );
    expect(parsed.version).toBe("2.1.0");
  });

  test("includes tool driver with rules", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          detectorId: "empty-error-handler",
          severity: "warning",
        }),
        makeFinding({
          detectorId: "insecure-defaults",
          severity: "error",
        }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const driver = parsed.runs[0].tool.driver;

    expect(driver.name).toBe("vibecop");
    expect(driver.version).toBe("0.1.0");
    expect(driver.informationUri).toBe("https://github.com/bhvbhushan/vibecop");

    // Should have two unique rules
    expect(driver.rules).toHaveLength(2);
    expect(driver.rules[0].id).toBe("empty-error-handler");
    expect(driver.rules[0].shortDescription.text).toBe("Empty Error Handler");
    expect(driver.rules[0].defaultConfiguration.level).toBe("warning");
    expect(driver.rules[0].properties.tags).toContain("quality");

    expect(driver.rules[1].id).toBe("insecure-defaults");
    expect(driver.rules[1].shortDescription.text).toBe("Insecure Defaults");
    expect(driver.rules[1].defaultConfiguration.level).toBe("error");
  });

  test("deduplicates rules from multiple findings with same detector", () => {
    const result = makeResult({
      findings: [
        makeFinding({ detectorId: "same-rule", file: "a.ts", line: 1 }),
        makeFinding({ detectorId: "same-rule", file: "b.ts", line: 2 }),
        makeFinding({ detectorId: "same-rule", file: "c.ts", line: 3 }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const driver = parsed.runs[0].tool.driver;

    expect(driver.rules).toHaveLength(1);
    expect(driver.rules[0].id).toBe("same-rule");

    // Should still have 3 results
    expect(parsed.runs[0].results).toHaveLength(3);
  });

  test("maps findings to results with correct locations", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          detectorId: "empty-error-handler",
          message: "Catch block only logs the error",
          severity: "warning",
          file: "src/utils.ts",
          line: 3,
          column: 5,
          endLine: 3,
          endColumn: 25,
        }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const sarifResult = parsed.runs[0].results[0];

    expect(sarifResult.ruleId).toBe("empty-error-handler");
    expect(sarifResult.level).toBe("warning");
    expect(sarifResult.message.text).toBe("Catch block only logs the error");

    const location = sarifResult.locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe("src/utils.ts");
    expect(location.region.startLine).toBe(3);
    expect(location.region.startColumn).toBe(5);
    expect(location.region.endLine).toBe(3);
    expect(location.region.endColumn).toBe(25);
  });

  test("defaults endLine/endColumn to startLine/startColumn when missing", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          line: 10,
          column: 3,
          // endLine and endColumn not set
        }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const region = parsed.runs[0].results[0].locations[0].physicalLocation.region;

    expect(region.startLine).toBe(10);
    expect(region.startColumn).toBe(3);
    expect(region.endLine).toBe(10);
    expect(region.endColumn).toBe(3);
  });

  test("maps severity levels correctly (error->error, warning->warning, info->note)", () => {
    const result = makeResult({
      findings: [
        makeFinding({ detectorId: "rule-error", severity: "error" }),
        makeFinding({ detectorId: "rule-warning", severity: "warning" }),
        makeFinding({ detectorId: "rule-info", severity: "info" }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const results = parsed.runs[0].results;

    expect(results[0].level).toBe("error");
    expect(results[1].level).toBe("warning");
    expect(results[2].level).toBe("note");

    // Also check the rules' default configuration
    const rules = parsed.runs[0].tool.driver.rules;
    expect(rules.find((r: { id: string }) => r.id === "rule-error").defaultConfiguration.level).toBe("error");
    expect(rules.find((r: { id: string }) => r.id === "rule-warning").defaultConfiguration.level).toBe("warning");
    expect(rules.find((r: { id: string }) => r.id === "rule-info").defaultConfiguration.level).toBe("note");
  });

  test("handles empty results", () => {
    const result = makeResult({
      findings: [],
      errors: [],
      filesScanned: 0,
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);

    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].results).toHaveLength(0);
    expect(parsed.runs[0].tool.driver.rules).toHaveLength(0);
    expect(parsed.runs[0].invocations[0].executionSuccessful).toBe(true);
    expect(parsed.runs[0].invocations[0].toolExecutionNotifications).toHaveLength(0);
  });

  test("includes invocations", () => {
    const result = makeResult({
      findings: [makeFinding()],
      errors: [],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const invocation = parsed.runs[0].invocations[0];

    expect(invocation).toBeDefined();
    expect(invocation.executionSuccessful).toBe(true);
    expect(invocation.toolExecutionNotifications).toHaveLength(0);
  });

  test("includes scan errors in invocation notifications", () => {
    const scanError: ScanError = {
      file: "src/broken.ts",
      detectorId: "some-detector",
      message: "Failed to parse file",
    };

    const result = makeResult({
      findings: [],
      errors: [scanError],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const invocation = parsed.runs[0].invocations[0];

    expect(invocation.executionSuccessful).toBe(false);
    expect(invocation.toolExecutionNotifications).toHaveLength(1);
    expect(invocation.toolExecutionNotifications[0].message.text).toBe(
      "Failed to parse file",
    );
    expect(invocation.toolExecutionNotifications[0].level).toBe("error");
  });

  test("includes ruleIndex in results", () => {
    const result = makeResult({
      findings: [
        makeFinding({ detectorId: "rule-a", file: "a.ts" }),
        makeFinding({ detectorId: "rule-b", file: "b.ts" }),
        makeFinding({ detectorId: "rule-a", file: "c.ts" }),
      ],
    });

    const output = formatSarif(result);
    const parsed = JSON.parse(output);
    const results = parsed.runs[0].results;

    expect(results[0].ruleIndex).toBe(0); // rule-a is first
    expect(results[1].ruleIndex).toBe(1); // rule-b is second
    expect(results[2].ruleIndex).toBe(0); // rule-a again, same index
  });
});
