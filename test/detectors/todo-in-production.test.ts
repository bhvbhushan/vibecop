import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { todoInProduction } from "../../src/detectors/todo-in-production.js";
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

describe("todo-in-production", () => {
  test("detector has correct metadata", () => {
    expect(todoInProduction.id).toBe("todo-in-production");
    expect(todoInProduction.meta.severity).toBe("info");
    expect(todoInProduction.meta.category).toBe("quality");
    expect(todoInProduction.meta.languages).toContain("typescript");
    expect(todoInProduction.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects // TODO: fix this as info finding", () => {
      const ctx = makeCtx(`
        function process() {
          // TODO: fix this later
          return null;
        }
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("todo-in-production");
      expect(findings[0].severity).toBe("info");
      expect(findings[0].message).toContain("TODO");
    });

    test("detects // FIXME: broken as info finding", () => {
      const ctx = makeCtx(`
        // FIXME: broken logic here
        function broken() {}
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("info");
      expect(findings[0].message).toContain("FIXME");
    });

    test("detects // TODO: fix auth encryption as warning (security keyword)", () => {
      const ctx = makeCtx(`
        // TODO: fix auth encryption
        function encrypt() {}
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("security-related");
    });

    test("detects // HACK: temporary as info finding", () => {
      const ctx = makeCtx(`
        // HACK: temporary workaround
        const x = 42;
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("info");
      expect(findings[0].message).toContain("HACK");
    });

    test("does NOT flag TODO in test file", () => {
      const ctx = makeCtx(
        `
        // TODO: add more test cases
        test("example", () => {});
      `,
        { filePath: "src/utils.test.ts" },
      );
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag TODO in __tests__ directory", () => {
      const ctx = makeCtx(
        `
        // TODO: improve coverage
        test("example", () => {});
      `,
        { filePath: "src/__tests__/utils.ts" },
      );
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag TODO in non-comment code", () => {
      const ctx = makeCtx(`
        const message = "TODO: fix this is a string";
        const todo = "FIXME later";
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects XXX comment", () => {
      const ctx = makeCtx(`
        // XXX: needs refactoring
        function legacy() {}
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("XXX");
    });

    test("detects multiple TODO/FIXME comments", () => {
      const ctx = makeCtx(`
        // TODO: first thing
        // FIXME: second thing
        // HACK: third thing
        function work() {}
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(3);
    });

    test("TODO with password keyword is warning severity", () => {
      const ctx = makeCtx(`
        // TODO: fix password validation
        function validate() {}
      `);
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("security-related");
    });
  });

  describe("Python", () => {
    test("detects # TODO in Python production code", () => {
      const ctx = makeCtx(
        `# TODO: implement this\ndef placeholder():\n    pass\n`,
        { language: "python", filePath: "src/app.py" },
      );
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].severity).toBe("info");
    });

    test("does NOT flag TODO in Python test file", () => {
      const ctx = makeCtx(
        `# TODO: add more tests\ndef test_something():\n    pass\n`,
        { language: "python", filePath: "src/tests/test_app.py" },
      );
      const findings = todoInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
