import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTestRules } from "../src/test-rules.js";

const TMP_DIR = join(import.meta.dir, ".tmp-test-rules-test");

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("runTestRules", () => {
  test("returns empty for nonexistent directory", () => {
    const result = runTestRules("/nonexistent/path");
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });

  test("passing rule with valid examples", () => {
    const dir = join(TMP_DIR, "passing");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "no-alert.yaml"),
      `
id: no-alert
name: No alert
description: Ban alert()
severity: warning
category: quality
languages: [javascript]
message: "alert() found."
rule:
  kind: call_expression
  has:
    kind: identifier
    regex: "^alert$"
examples:
  valid:
    - "console.log('hi')"
  invalid:
    - "alert('hello')"
`,
    );

    const result = runTestRules(dir);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("failing rule where invalid example does not match", () => {
    const dir = join(TMP_DIR, "failing");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bad-rule.yaml"),
      `
id: bad-rule
name: Bad Rule
description: Broken rule
severity: info
category: quality
languages: [javascript]
message: "Found."
rule:
  kind: identifier
  regex: "^IMPOSSIBLE_NAME_THAT_NEVER_EXISTS_12345$"
examples:
  invalid:
    - "const x = 1;"
`,
    );

    const result = runTestRules(dir);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
  });

  test("rule without examples passes", () => {
    const dir = join(TMP_DIR, "no-examples");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "simple.yaml"),
      `
id: simple-rule
name: Simple
description: No examples
severity: info
category: quality
languages: [javascript]
message: "Found."
rule:
  kind: identifier
  regex: "^foo$"
`,
    );

    const result = runTestRules(dir);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });
});
