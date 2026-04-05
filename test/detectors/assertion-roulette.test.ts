import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { assertionRoulette } from "../../src/detectors/assertion-roulette.js";
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
    config?: Record<string, unknown>;
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
  return {
    file,
    root,
    source,
    project: EMPTY_PROJECT,
    config: options.config ?? {},
  };
}

describe("assertion-roulette", () => {
  test("detector has correct metadata", () => {
    expect(assertionRoulette.id).toBe("assertion-roulette");
    expect(assertionRoulette.meta.severity).toBe("warning");
    expect(assertionRoulette.meta.category).toBe("testing");
  });

  test("3 assertions → no finding", () => {
    const ctx = makeCtx(`
      test('works', () => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
      });
    `);
    expect(assertionRoulette.detect(ctx).length).toBe(0);
  });

  test("9 assertions → finding (above default threshold of 8)", () => {
    const ctx = makeCtx(`
      test('works', () => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
        expect(d).toBe(4);
        expect(e).toBe(5);
        expect(f).toBe(6);
        expect(g).toBe(7);
        expect(h).toBe(8);
        expect(i).toBe(9);
      });
    `);
    const findings = assertionRoulette.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("9 assertions");
  });

  test("configurable threshold works", () => {
    const ctx = makeCtx(
      `
      test('works', () => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
      });
    `,
      { config: { maxAssertions: 2 } },
    );
    const findings = assertionRoulette.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("3 assertions");
  });

  test("Python assert statements counted", () => {
    const ctx = makeCtx(
      `
def test_many():
    assert a == 1
    assert b == 2
    assert c == 3
    assert d == 4
    assert e == 5
    assert f == 6
    assert g == 7
    assert h == 8
    assert i == 9
`,
      { language: "python", filePath: "test_example.py" },
    );
    const findings = assertionRoulette.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("9 assertions");
  });

  test("6 assertions → no finding (below default threshold of 8)", () => {
    const ctx = makeCtx(`
      test('works', () => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
        expect(d).toBe(4);
        expect(e).toBe(5);
        expect(f).toBe(6);
      });
    `);
    expect(assertionRoulette.detect(ctx).length).toBe(0);
  });

  test("non-test files ignored", () => {
    const ctx = makeCtx(
      `
      test('works', () => {
        expect(a).toBe(1);
        expect(b).toBe(2);
        expect(c).toBe(3);
        expect(d).toBe(4);
        expect(e).toBe(5);
        expect(f).toBe(6);
        expect(g).toBe(7);
        expect(h).toBe(8);
        expect(i).toBe(9);
      });
    `,
      { filePath: "src/utils.ts" },
    );
    expect(assertionRoulette.detect(ctx).length).toBe(0);
  });
});
