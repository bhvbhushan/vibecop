import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { emptyErrorHandler } from "../../src/detectors/empty-error-handler.js";
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
  language: "typescript" | "javascript" | "python" = "typescript",
): DetectionContext {
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
  const root = parse(langMap[language] as Lang, source);
  const file: FileInfo = {
    path: `test.${extMap[language].slice(1)}`,
    absolutePath: `/test.${extMap[language].slice(1)}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("empty-error-handler", () => {
  test("detector has correct metadata", () => {
    expect(emptyErrorHandler.id).toBe("empty-error-handler");
    expect(emptyErrorHandler.meta.severity).toBe("warning");
    expect(emptyErrorHandler.meta.category).toBe("quality");
    expect(emptyErrorHandler.meta.languages).toContain("typescript");
    expect(emptyErrorHandler.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects empty catch block", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) {}
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("Empty catch block");
    });

    test("detects console.log-only catch block", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { console.log(e); }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("only logs");
    });

    test("detects console.error-only catch block", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { console.error(e); }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("only logs");
    });

    test("detects console.warn-only catch block", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { console.warn(e); }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("only logs");
    });

    test("does NOT flag catch block with block comment", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { /* intentionally empty */ }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag catch block with line comment", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) {
          // ignore this
        }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag catch block that re-throws", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { throw new Error("fail"); }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag catch block with return", () => {
      const ctx = makeCtx(`
        function x() {
          try { foo(); } catch (e) { return null; }
        }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag catch block with multiple statements", () => {
      const ctx = makeCtx(`
        try { foo(); } catch (e) { cleanup(); throw e; }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects multiple empty catches in one file", () => {
      const ctx = makeCtx(`
        try { a(); } catch (e) {}
        try { b(); } catch (e) { console.log(e); }
        try { c(); } catch (e) { throw e; }
      `);
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(2);
    });
  });

  describe("Python", () => {
    test("detects except: pass", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept:\n    pass\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("pass");
    });

    test("detects except Exception as e: pass", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept Exception as e:\n    pass\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("detects except with only print(e)", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept Exception as e:\n    print(e)\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("only logs");
    });

    test("does NOT flag except with raise", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept Exception as e:\n    raise ValueError("fail")\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag except with comment and pass", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept Exception as e:\n    # intentionally empty\n    pass\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag except with multiple statements", () => {
      const ctx = makeCtx(
        `try:\n    foo()\nexcept Exception as e:\n    cleanup()\n    raise\n`,
        "python",
      );
      const findings = emptyErrorHandler.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
