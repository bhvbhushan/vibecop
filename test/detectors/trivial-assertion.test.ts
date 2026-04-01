import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { trivialAssertion } from "../../src/detectors/trivial-assertion.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

// Register Python for tests
try {
  const req = createRequire(import.meta.url);
  const pythonLang = req("@ast-grep/lang-python") as {
    libraryPath: string;
    extensions: string[];
    languageSymbol?: string;
    expandoChar?: string;
  };
  registerDynamicLanguage({ python: pythonLang });
} catch {
  // Python support may not be available in test env
}

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

describe("trivial-assertion", () => {
  test("detector has correct metadata", () => {
    expect(trivialAssertion.id).toBe("trivial-assertion");
    expect(trivialAssertion.meta.severity).toBe("warning");
    expect(trivialAssertion.meta.category).toBe("testing");
    expect(trivialAssertion.meta.languages).toContain("typescript");
    expect(trivialAssertion.meta.languages).toContain("python");
  });

  describe("test file detection", () => {
    test("only runs on test files", () => {
      const ctx = makeCtx(`expect(true).toBe(true);`, {
        filePath: "src/utils.ts",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("runs on .test.ts files", () => {
      const ctx = makeCtx(`expect(true).toBe(true);`, {
        filePath: "src/utils.test.ts",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("runs on .spec.ts files", () => {
      const ctx = makeCtx(`expect(true).toBe(true);`, {
        filePath: "src/utils.spec.ts",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("runs on files in __test__ directory", () => {
      const ctx = makeCtx(`expect(true).toBe(true);`, {
        filePath: "__test__/utils.ts",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });
  });

  describe("JavaScript/TypeScript", () => {
    test("detects expect(true).toBe(true)", () => {
      const ctx = makeCtx(`expect(true).toBe(true);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("true");
      expect(findings[0].message).toContain("always passes");
    });

    test("detects expect(false).toBe(false)", () => {
      const ctx = makeCtx(`expect(false).toBe(false);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("detects expect(1).toBe(1)", () => {
      const ctx = makeCtx(`expect(1).toBe(1);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("1");
    });

    test('detects expect("foo").toBe("foo")', () => {
      const ctx = makeCtx(`expect("foo").toBe("foo");`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("detects expect(42).toEqual(42)", () => {
      const ctx = makeCtx(`expect(42).toEqual(42);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("detects expect(true).toBeTruthy()", () => {
      const ctx = makeCtx(`expect(true).toBeTruthy();`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("toBeTruthy");
    });

    test("detects expect(false).toBeFalsy()", () => {
      const ctx = makeCtx(`expect(false).toBeFalsy();`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("toBeFalsy");
    });

    test("does NOT flag expect(result).toBe(true) — variable, not literal", () => {
      const ctx = makeCtx(`expect(result).toBe(true);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag expect(1).toBe(2) — different literals", () => {
      const ctx = makeCtx(`expect(1).toBe(2);`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test('does NOT flag expect("foo").toBe("bar") — different strings', () => {
      const ctx = makeCtx(`expect("foo").toBe("bar");`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag expect(result).toBeTruthy() — variable", () => {
      const ctx = makeCtx(`expect(result).toBeTruthy();`);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects multiple trivial assertions", () => {
      const ctx = makeCtx(`
        expect(true).toBe(true);
        expect(1).toBe(1);
        expect(result).toBe(true);
      `);
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(2);
    });
  });

  describe("Python", () => {
    test("detects assert True", () => {
      const ctx = makeCtx(`assert True\n`, {
        language: "python",
        filePath: "test_example.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("assert True");
      expect(findings[0].message).toContain("always passes");
    });

    test("detects assert False", () => {
      const ctx = makeCtx(`assert False\n`, {
        language: "python",
        filePath: "test_example.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("assert False");
      expect(findings[0].message).toContain("always fails");
    });

    test("detects assert 1 == 1", () => {
      const ctx = makeCtx(`assert 1 == 1\n`, {
        language: "python",
        filePath: "test_example.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("does NOT flag assert x == True (variable)", () => {
      const ctx = makeCtx(`assert x == True\n`, {
        language: "python",
        filePath: "test_example.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag assert x == 1 (variable)", () => {
      const ctx = makeCtx(`assert x == 1\n`, {
        language: "python",
        filePath: "test_example.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("only runs on test files for Python", () => {
      const ctx = makeCtx(`assert True\n`, {
        language: "python",
        filePath: "utils.py",
      });
      const findings = trivialAssertion.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
