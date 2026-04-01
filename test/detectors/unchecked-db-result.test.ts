import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { uncheckedDbResult } from "../../src/detectors/unchecked-db-result.js";
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

describe("unchecked-db-result", () => {
  test("detector has correct metadata", () => {
    expect(uncheckedDbResult.id).toBe("unchecked-db-result");
    expect(uncheckedDbResult.meta.severity).toBe("warning");
    expect(uncheckedDbResult.meta.category).toBe("correctness");
    expect(uncheckedDbResult.meta.languages).toContain("typescript");
    expect(uncheckedDbResult.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects standalone await db.insert()", () => {
      const ctx = makeCtx(`
        async function createUser() {
          await db.insert({ name: "test" });
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("unchecked-db-result");
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("not checked");
    });

    test("does NOT flag when result is stored: const result = await db.insert()", () => {
      const ctx = makeCtx(`
        async function createUser() {
          const result = await db.insert({ name: "test" });
          return result;
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects standalone await db.delete()", () => {
      const ctx = makeCtx(`
        async function removeUser(id: string) {
          await db.delete({ where: { id } });
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("not checked");
    });

    test("detects standalone await db.update()", () => {
      const ctx = makeCtx(`
        async function updateUser(id: string) {
          await db.update({ where: { id }, data: { name: "new" } });
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("does NOT flag non-DB standalone await", () => {
      const ctx = makeCtx(`
        async function doWork() {
          await sleep(1000);
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag in test file", () => {
      const ctx = makeCtx(
        `
        async function test() {
          await db.insert({ name: "test" });
        }
      `,
        { filePath: "src/app.test.ts" },
      );
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag when result is assigned with let", () => {
      const ctx = makeCtx(`
        async function createUser() {
          let result = await db.insert({ name: "test" });
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects multiple unchecked mutations", () => {
      const ctx = makeCtx(`
        async function batchOps() {
          await db.insert({ name: "a" });
          await db.delete({ id: "1" });
          const r = await db.update({ id: "2" });
        }
      `);
      const findings = uncheckedDbResult.detect(ctx);
      expect(findings.length).toBe(2);
    });
  });
});
