import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { nPlusOneQuery } from "../../src/detectors/n-plus-one-query.js";
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

describe("n-plus-one-query", () => {
  test("detector has correct metadata", () => {
    expect(nPlusOneQuery.id).toBe("n-plus-one-query");
    expect(nPlusOneQuery.meta.severity).toBe("warning");
    expect(nPlusOneQuery.meta.category).toBe("quality");
    expect(nPlusOneQuery.meta.languages).toContain("typescript");
    expect(nPlusOneQuery.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects DB call (findMany) inside for loop", () => {
      const ctx = makeCtx(`
        async function loadUsers(ids: string[]) {
          for (let i = 0; i < ids.length; i++) {
            await prisma.user.findMany({ where: { id: ids[i] } });
          }
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].detectorId).toBe("n-plus-one-query");
      expect(findings[0].severity).toBe("warning");
      expect(findings[0].message).toContain("N+1");
    });

    test("detects fetch() inside for-of loop", () => {
      const ctx = makeCtx(`
        async function fetchAll(urls: string[]) {
          for (const url of urls) {
            await fetch(url);
          }
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].message).toContain("N+1");
    });

    test("detects DB call inside while loop", () => {
      const ctx = makeCtx(`
        async function processQueue() {
          let hasMore = true;
          while (hasMore) {
            await db.query("SELECT * FROM items LIMIT 1");
            hasMore = false;
          }
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].message).toContain("N+1");
    });

    test("does NOT flag DB call outside loop", () => {
      const ctx = makeCtx(`
        async function getUsers() {
          const users = await prisma.user.findMany();
          return users;
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects .map(async => await db.find()) pattern", () => {
      const ctx = makeCtx(`
        async function loadDetails(ids: string[]) {
          const results = ids.map(async (id) => {
            return await db.findOne({ id });
          });
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].message).toContain("N+1");
    });

    test("does NOT flag non-DB call inside loop", () => {
      const ctx = makeCtx(`
        function processItems(items: string[]) {
          for (const item of items) {
            console.log(item);
            doSomething(item);
          }
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects execute() inside for loop", () => {
      const ctx = makeCtx(`
        async function runQueries(queries: string[]) {
          for (const q of queries) {
            await db.execute(q);
          }
        }
      `);
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Python", () => {
    test("detects DB call inside for loop", () => {
      const ctx = makeCtx(
        `for item in items:\n    cursor.execute("SELECT * FROM t WHERE id = %s", (item,))\n`,
        "python",
      );
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].detectorId).toBe("n-plus-one-query");
      expect(findings[0].message).toContain("N+1");
    });

    test("does NOT flag DB call outside loop in Python", () => {
      const ctx = makeCtx(
        `result = cursor.execute("SELECT * FROM users")\n`,
        "python",
      );
      const findings = nPlusOneQuery.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
