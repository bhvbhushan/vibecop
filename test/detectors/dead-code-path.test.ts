import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { deadCodePath } from "../../src/detectors/dead-code-path.js";
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
    path: `src/app.${extMap[language].slice(1)}`,
    absolutePath: `/src/app.${extMap[language].slice(1)}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("dead-code-path", () => {
  test("detector has correct metadata", () => {
    expect(deadCodePath.id).toBe("dead-code-path");
    expect(deadCodePath.meta.severity).toBe("warning");
    expect(deadCodePath.meta.category).toBe("quality");
    expect(deadCodePath.meta.languages).toContain("typescript");
    expect(deadCodePath.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects identical if/else branches", () => {
      const ctx = makeCtx(`
        function check(x: boolean) {
          if (x) {
            doSomething();
          } else {
            doSomething();
          }
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("dead-code-path");
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("identical");
    });

    test("does NOT flag different if/else branches", () => {
      const ctx = makeCtx(`
        function check(x: boolean) {
          if (x) {
            doA();
          } else {
            doB();
          }
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects code after return", () => {
      const ctx = makeCtx(`
        function foo() {
          return 42;
          console.log("never reached");
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("Unreachable");
    });

    test("detects code after throw", () => {
      const ctx = makeCtx(`
        function bar() {
          throw new Error("fail");
          cleanup();
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("Unreachable");
    });

    test("does NOT flag normal sequential code", () => {
      const ctx = makeCtx(`
        function normal() {
          const a = 1;
          const b = 2;
          return a + b;
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag code with return at the end", () => {
      const ctx = makeCtx(`
        function valid() {
          doSetup();
          doWork();
          return result;
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects both identical branches and unreachable code", () => {
      const ctx = makeCtx(`
        function complex(x: boolean) {
          if (x) {
            doA();
          } else {
            doA();
          }
          return 1;
          unreachable();
        }
      `);
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(2);
    });
  });

  describe("Python", () => {
    test("detects identical if/else branches in Python", () => {
      const ctx = makeCtx(
        `if x:\n    do_something()\nelse:\n    do_something()\n`,
        "python",
      );
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("identical");
    });

    test("does NOT flag different if/else branches in Python", () => {
      const ctx = makeCtx(
        `if x:\n    do_a()\nelse:\n    do_b()\n`,
        "python",
      );
      const findings = deadCodePath.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
