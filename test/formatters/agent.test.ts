import { describe, expect, test } from "bun:test";
import { formatAgent } from "../../src/formatters/agent.js";
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

describe("formatAgent", () => {
  test("formats a single finding correctly", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          file: "src/agent.ts",
          line: 42,
          column: 1,
          severity: "error",
          detectorId: "unsafe-shell-exec",
          message: "exec() with template literal allows shell injection",
        }),
      ],
    });

    const output = formatAgent(result);

    expect(output).toBe(
      "src/agent.ts:42:1 error unsafe-shell-exec: exec() with template literal allows shell injection",
    );
  });

  test("formats multiple findings, one per line", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          file: "src/agent.ts",
          line: 42,
          column: 1,
          severity: "error",
          detectorId: "unsafe-shell-exec",
          message: "exec() with template literal allows shell injection",
        }),
        makeFinding({
          file: "src/llm.ts",
          line: 18,
          column: 5,
          severity: "warning",
          detectorId: "llm-call-no-timeout",
          message: "openai.chat.completions.create() has no timeout",
        }),
      ],
    });

    const output = formatAgent(result);
    const lines = output.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      "src/agent.ts:42:1 error unsafe-shell-exec: exec() with template literal allows shell injection",
    );
    expect(lines[1]).toBe(
      "src/llm.ts:18:5 warning llm-call-no-timeout: openai.chat.completions.create() has no timeout",
    );
  });

  test("returns empty string when there are no findings", () => {
    const result = makeResult({ findings: [] });

    const output = formatAgent(result);

    expect(output).toBe("");
  });

  test("includes suggestion when present", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          file: "src/agent.ts",
          line: 42,
          column: 1,
          severity: "error",
          detectorId: "unsafe-shell-exec",
          message: "exec() with template literal allows shell injection",
          suggestion: "Use execFile() with argument array instead",
        }),
      ],
    });

    const output = formatAgent(result);

    expect(output).toBe(
      "src/agent.ts:42:1 error unsafe-shell-exec: exec() with template literal allows shell injection. Use execFile() with argument array instead",
    );
  });

  test("omits suggestion suffix when no suggestion is provided", () => {
    const result = makeResult({
      findings: [
        makeFinding({
          file: "src/utils.ts",
          line: 10,
          column: 3,
          severity: "warning",
          detectorId: "some-detector",
          message: "Some issue without a suggestion",
          suggestion: undefined,
        }),
      ],
    });

    const output = formatAgent(result);

    expect(output).toBe(
      "src/utils.ts:10:3 warning some-detector: Some issue without a suggestion",
    );
    expect(output).not.toContain(". ");
  });
});
