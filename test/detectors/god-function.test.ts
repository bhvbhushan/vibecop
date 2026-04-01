import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { godFunction } from "../../src/detectors/god-function.js";
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

/** Generate a function body with N lines including branching for complexity */
function generateLines(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    // Add if-statements every 10 lines to build cyclomatic complexity
    if (i % 10 === 0 && i > 0) return `  if (v${i - 1} > 0) { console.log(v${i - 1}); }`;
    return `  const v${i} = ${i};`;
  }).join("\n");
}

describe("god-function", () => {
  test("detector has correct metadata", () => {
    expect(godFunction.id).toBe("god-function");
    expect(godFunction.meta.severity).toBe("warning");
    expect(godFunction.meta.category).toBe("quality");
    expect(godFunction.meta.languages).toContain("typescript");
    expect(godFunction.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("short function (<50 lines) produces no finding", () => {
      const ctx = makeCtx(`
        function shortFn() {
${generateLines(10)}
        }
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("long function (60 lines) produces warning finding with line count", () => {
      const ctx = makeCtx(`
        function longFn() {
${generateLines(58)}
        }
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("god-function");
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("longFn");
      expect(findings[0].message).toContain("60");
    });

    test("function with high cyclomatic complexity produces warning", () => {
      // 16+ branching statements to exceed default threshold of 15
      const ctx = makeCtx(`
        function complexFn(x: number) {
          if (x > 0) { console.log(1); }
          if (x > 1) { console.log(2); }
          if (x > 2) { console.log(3); }
          if (x > 3) { console.log(4); }
          if (x > 4) { console.log(5); }
          if (x > 5) { console.log(6); }
          if (x > 6) { console.log(7); }
          if (x > 7) { console.log(8); }
          if (x > 8) { console.log(9); }
          if (x > 9) { console.log(10); }
          if (x > 10) { console.log(11); }
          if (x > 11) { console.log(12); }
          if (x > 12) { console.log(13); }
          if (x > 13) { console.log(14); }
          if (x > 14) { console.log(15); }
          if (x > 15) { console.log(16); }
          return x;
        }
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("complexFn");
      expect(findings[0].message).toContain("complexity");
    });

    test("function with many params (6+) produces warning", () => {
      const ctx = makeCtx(`
        function manyParams(a: string, b: string, c: string, d: string, e: string, f: string) {
          return a + b + c + d + e + f;
        }
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("manyParams");
      expect(findings[0].message).toContain("6 params");
    });

    test("very long function (>100 lines) produces error severity", () => {
      const ctx = makeCtx(`
        function veryLongFn() {
${generateLines(100)}
        }
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("veryLongFn");
    });

    test("test file produces no findings", () => {
      const ctx = makeCtx(
        `
        function longFn() {
${generateLines(58)}
        }
        `,
        { filePath: "src/utils.test.ts" },
      );
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("short arrow function callback produces no finding", () => {
      const ctx = makeCtx(`
        const items = [1, 2, 3];
        items.forEach((item) => {
          console.log(item);
        });
      `);
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("long Python function with branching produces warning", () => {
      const lines = Array.from({ length: 58 }, (_, i) => {
        if (i % 10 === 0 && i > 0) return `    if v${i - 1} > 0:\n        print(v${i - 1})`;
        return `    v${i} = ${i}`;
      }).join("\n");
      const ctx = makeCtx(
        `def long_func():\n${lines}\n`,
        { language: "python" },
      );
      const findings = godFunction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("long_func");
    });
  });
});
