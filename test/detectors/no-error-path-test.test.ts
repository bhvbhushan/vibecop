import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { noErrorPathTest } from "../../src/detectors/no-error-path-test.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

try {
  const req = createRequire(import.meta.url);
  const pythonLang = req("@ast-grep/lang-python") as {
    libraryPath: string;
    extensions: string[];
  };
  registerDynamicLanguage({ python: pythonLang });
} catch {}

function makeCtx(
  source: string,
  options: {
    language?: "typescript" | "javascript" | "python";
    filePath?: string;
  } = {},
): DetectionContext {
  const language = options.language ?? "typescript";
  const langMap: Record<string, Lang | string> = {
    typescript: Lang.TypeScript,
    javascript: Lang.JavaScript,
    python: "python",
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    javascript: ".js",
    python: ".py",
  };
  const defaultPath = `example.test.${extMap[language].slice(1)}`;
  const filePath = options.filePath ?? defaultPath;
  const root = parse(langMap[language] as Lang, source);
  const file: FileInfo = {
    path: filePath,
    absolutePath: `/${filePath}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("no-error-path-test", () => {
  test("detector has correct metadata", () => {
    expect(noErrorPathTest.id).toBe("no-error-path-test");
    expect(noErrorPathTest.meta.severity).toBe("info");
    expect(noErrorPathTest.meta.category).toBe("testing");
  });

  test("file with 5 tests, zero .toThrow → finding", () => {
    const ctx = makeCtx(`
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
      test('c', () => { expect(3).toBe(3); });
      test('d', () => { expect(4).toBe(4); });
      test('e', () => { expect(5).toBe(5); });
    `);
    const findings = noErrorPathTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("5 tests");
    expect(findings[0].message).toContain("no error path");
  });

  test("file with 5 tests, 1 .toThrow → no finding", () => {
    const ctx = makeCtx(`
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
      test('c', () => { expect(3).toBe(3); });
      test('d', () => { expect(4).toBe(4); });
      test('throws', () => { expect(() => fn()).toThrow(); });
    `);
    expect(noErrorPathTest.detect(ctx).length).toBe(0);
  });

  test("file with 2 tests, zero .toThrow → no finding (below threshold)", () => {
    const ctx = makeCtx(`
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
    `);
    expect(noErrorPathTest.detect(ctx).length).toBe(0);
  });

  test("Python file with pytest.raises → no finding", () => {
    const ctx = makeCtx(
      `
def test_a():
    assert 1 == 1

def test_b():
    assert 2 == 2

def test_c():
    with pytest.raises(ValueError):
        do_thing()
`,
      { language: "python", filePath: "test_example.py" },
    );
    expect(noErrorPathTest.detect(ctx).length).toBe(0);
  });

  test("non-test file → no finding", () => {
    const ctx = makeCtx(
      `
      test('a', () => { expect(1).toBe(1); });
      test('b', () => { expect(2).toBe(2); });
      test('c', () => { expect(3).toBe(3); });
    `,
      { filePath: "src/utils.ts" },
    );
    expect(noErrorPathTest.detect(ctx).length).toBe(0);
  });
});
