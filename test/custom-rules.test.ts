import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse, Lang } from "@ast-grep/napi";
import { loadCustomRules } from "../src/custom-rules.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../src/types.js";

const TMP_DIR = join(import.meta.dir, ".tmp-custom-rules-test");

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(source: string): DetectionContext {
  const root = parse(Lang.JavaScript, source);
  const file: FileInfo = {
    path: "src/app.js",
    absolutePath: "/src/app.js",
    language: "javascript",
    extension: ".js",
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("loadCustomRules", () => {
  test("returns empty array for missing directory", () => {
    const detectors = loadCustomRules("/nonexistent/path");
    expect(detectors).toEqual([]);
  });

  test("returns empty array for empty directory", () => {
    const dir = join(TMP_DIR, "empty");
    mkdirSync(dir, { recursive: true });
    const detectors = loadCustomRules(dir);
    expect(detectors).toEqual([]);
  });

  test("loads a valid YAML rule and creates a working detector", () => {
    const dir = join(TMP_DIR, "valid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "no-alert.yaml"),
      `
id: no-alert
name: No alert()
description: Do not use alert()
severity: warning
category: quality
languages: [javascript, typescript]
message: "alert() is not allowed in production code."
suggestion: "Use a toast notification or modal instead."
rule:
  kind: call_expression
  has:
    kind: identifier
    regex: "^alert$"
`,
    );

    const detectors = loadCustomRules(dir);
    expect(detectors.length).toBe(1);
    expect(detectors[0].id).toBe("no-alert");
    expect(detectors[0].meta.severity).toBe("warning");

    // Test the detector actually works
    const ctx = makeCtx(`alert("hello");`);
    const findings = detectors[0].detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("alert()");
  });

  test("skips invalid YAML files gracefully", () => {
    const dir = join(TMP_DIR, "invalid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bad.yaml"),
      `
id: 123
name: Bad Rule
`,
    );

    // Should not throw, just warn and skip
    const detectors = loadCustomRules(dir);
    expect(detectors.length).toBe(0);
  });

  test("loads multiple rules from multiple files", () => {
    const dir = join(TMP_DIR, "multi");
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, "rule1.yaml"),
      `
id: rule-one
name: Rule One
description: First rule
severity: info
category: quality
languages: [javascript]
message: "Rule one triggered."
rule:
  kind: identifier
  regex: "^foo$"
`,
    );
    writeFileSync(
      join(dir, "rule2.yml"),
      `
id: rule-two
name: Rule Two
description: Second rule
severity: error
category: security
languages: [javascript]
message: "Rule two triggered."
rule:
  kind: identifier
  regex: "^bar$"
`,
    );

    const detectors = loadCustomRules(dir);
    expect(detectors.length).toBe(2);
    expect(detectors.map((d) => d.id).sort()).toEqual(["rule-one", "rule-two"]);
  });

  test("ignores non-yaml files", () => {
    const dir = join(TMP_DIR, "mixed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "readme.md"), "# Rules");
    writeFileSync(
      join(dir, "valid.yaml"),
      `
id: valid-rule
name: Valid
description: A valid rule
severity: info
category: quality
languages: [javascript]
message: "Found."
rule:
  kind: identifier
  regex: "^test$"
`,
    );

    const detectors = loadCustomRules(dir);
    expect(detectors.length).toBe(1);
  });
});
