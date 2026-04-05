import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { conditionalTestLogic } from "../../src/detectors/conditional-test-logic.js";
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

describe("conditional-test-logic", () => {
  test("detector has correct metadata", () => {
    expect(conditionalTestLogic.id).toBe("conditional-test-logic");
    expect(conditionalTestLogic.meta.severity).toBe("info");
    expect(conditionalTestLogic.meta.category).toBe("testing");
  });

  test("if/else with expect inside → finding", () => {
    const ctx = makeCtx(`
      test('conditional', () => {
        if (condition) {
          expect(a).toBe(1);
        } else {
          expect(a).toBe(2);
        }
      });
    `);
    const findings = conditionalTestLogic.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("if statement");
  });

  test("for loop with expect inside → finding", () => {
    const ctx = makeCtx(`
      test('loop', () => {
        for (const item of items) {
          expect(item).toBeDefined();
        }
      });
    `);
    const findings = conditionalTestLogic.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("for in statement");
  });

  test("if in setup (no expect inside) → no finding", () => {
    const ctx = makeCtx(`
      test('works', () => {
        if (env === 'test') {
          setupMock();
        }
        expect(result).toBe(42);
      });
    `);
    expect(conditionalTestLogic.detect(ctx).length).toBe(0);
  });

  test("test.each callback → no finding", () => {
    const ctx = makeCtx(`
      test.each([1, 2, 3])('works with %i', (val) => {
        if (val > 1) {
          expect(val).toBeGreaterThan(0);
        }
      });
    `);
    expect(conditionalTestLogic.detect(ctx).length).toBe(0);
  });

  test("it.each callback → no finding", () => {
    const ctx = makeCtx(`
      it.each([1, 2, 3])('works with %i', (val) => {
        if (val > 1) {
          expect(val).toBeGreaterThan(0);
        }
      });
    `);
    expect(conditionalTestLogic.detect(ctx).length).toBe(0);
  });

  test("Python for loop with assert inside → finding", () => {
    const ctx = makeCtx(
      `
def test_loop():
    for item in items:
        assert item > 0
`,
      { language: "python", filePath: "test_example.py" },
    );
    const findings = conditionalTestLogic.detect(ctx);
    expect(findings.length).toBe(1);
  });

  test("non-test file → no finding", () => {
    const ctx = makeCtx(
      `
      test('conditional', () => {
        if (condition) { expect(a).toBe(1); }
      });
    `,
      { filePath: "src/utils.ts" },
    );
    expect(conditionalTestLogic.detect(ctx).length).toBe(0);
  });
});
