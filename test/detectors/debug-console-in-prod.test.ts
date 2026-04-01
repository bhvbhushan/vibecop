import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { debugConsoleInProd } from "../../src/detectors/debug-console-in-prod.js";
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
  const defaultPath = `src/app.${extMap[language].slice(1)}`;
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

describe("debug-console-in-prod", () => {
  test("detector has correct metadata", () => {
    expect(debugConsoleInProd.id).toBe("debug-console-in-prod");
    expect(debugConsoleInProd.meta.severity).toBe("warning");
    expect(debugConsoleInProd.meta.category).toBe("quality");
    expect(debugConsoleInProd.meta.languages).toContain("typescript");
    expect(debugConsoleInProd.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects console.log in production file", () => {
      const ctx = makeCtx(`console.log("debug info");`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("debug-console-in-prod");
      expect(findings[0].message).toContain("console.log");
      expect(findings[0].severity).toBe("warning");
    });

    test("detects console.debug in production file", () => {
      const ctx = makeCtx(`console.debug("trace info");`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("console.debug");
    });

    test("does NOT flag console.error (legitimate)", () => {
      const ctx = makeCtx(`console.error("Something went wrong");`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag console.warn (legitimate)", () => {
      const ctx = makeCtx(`console.warn("Deprecated feature");`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag console.log in test file", () => {
      const ctx = makeCtx(`console.log("test output");`, {
        filePath: "src/utils.test.ts",
      });
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag console.log in __tests__ directory", () => {
      const ctx = makeCtx(`console.log("test output");`, {
        filePath: "src/__tests__/utils.ts",
      });
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects console.dir in production", () => {
      const ctx = makeCtx(`console.dir(myObject);`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("console.dir");
    });

    test("detects console.table in production", () => {
      const ctx = makeCtx(`console.table(data);`);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("console.table");
    });

    test("detects multiple console calls", () => {
      const ctx = makeCtx(`
        console.log("first");
        console.debug("second");
        console.error("third");
      `);
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(2);
    });
  });

  describe("Python", () => {
    test("detects print() in production", () => {
      const ctx = makeCtx(
        `print("debug output")\n`,
        { language: "python", filePath: "src/app.py" },
      );
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("debug-console-in-prod");
      expect(findings[0].message).toContain("print()");
    });

    test("does NOT flag print() in test file", () => {
      const ctx = makeCtx(
        `print("test output")\n`,
        { language: "python", filePath: "src/tests/test_app.py" },
      );
      const findings = debugConsoleInProd.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
