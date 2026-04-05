import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { emptyTest } from "../../src/detectors/empty-test.js";
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

describe("empty-test", () => {
  test("detector has correct metadata", () => {
    expect(emptyTest.id).toBe("empty-test");
    expect(emptyTest.meta.severity).toBe("info");
    expect(emptyTest.meta.category).toBe("testing");
  });

  test("test with zero expect() → finding", () => {
    const ctx = makeCtx(`
      test('does nothing', () => {
        const x = 1;
      });
    `);
    const findings = emptyTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("no assertions");
  });

  test("test with 1+ expect() → no finding", () => {
    const ctx = makeCtx(`
      test('works', () => {
        expect(result).toBe(42);
      });
    `);
    expect(emptyTest.detect(ctx).length).toBe(0);
  });

  test("test with done() callback → no finding", () => {
    const ctx = makeCtx(`
      test('async', (done) => {
        fetchData(() => {
          done();
        });
      });
    `);
    expect(emptyTest.detect(ctx).length).toBe(0);
  });

  test("test with expect.assertions(N) → no finding", () => {
    const ctx = makeCtx(`
      test('async assertions', () => {
        expect.assertions(1);
        return promise.then(v => expect(v).toBe(42));
      });
    `);
    expect(emptyTest.detect(ctx).length).toBe(0);
  });

  test("Python def test_x(): pass → finding", () => {
    const ctx = makeCtx(
      `
def test_empty():
    pass
`,
      { language: "python", filePath: "test_example.py" },
    );
    const findings = emptyTest.detect(ctx);
    expect(findings.length).toBe(1);
  });

  test("Python def test_x(): assert result == 1 → no finding", () => {
    const ctx = makeCtx(
      `
def test_works():
    assert result == 1
`,
      { language: "python", filePath: "test_example.py" },
    );
    expect(emptyTest.detect(ctx).length).toBe(0);
  });

  test("non-test file ignored", () => {
    const ctx = makeCtx(
      `test('does nothing', () => { const x = 1; });`,
      { filePath: "src/utils.ts" },
    );
    expect(emptyTest.detect(ctx).length).toBe(0);
  });
});
