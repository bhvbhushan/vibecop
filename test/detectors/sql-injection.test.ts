import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { sqlInjection } from "../../src/detectors/sql-injection.js";
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
  const defaultPath = `src/db.${extMap[language].slice(1)}`;
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

describe("sql-injection", () => {
  test("detector has correct metadata", () => {
    expect(sqlInjection.id).toBe("sql-injection");
    expect(sqlInjection.meta.severity).toBe("error");
    expect(sqlInjection.meta.category).toBe("security");
    expect(sqlInjection.meta.languages).toContain("typescript");
    expect(sqlInjection.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects template literal in query()", () => {
      const ctx = makeCtx("db.query(`SELECT * FROM users WHERE id = ${id}`);");
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("sql-injection");
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("template literal");
    });

    test("detects string concatenation in execute()", () => {
      const ctx = makeCtx(`db.execute("SELECT * FROM " + table);`);
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("sql-injection");
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("concatenation");
    });

    test("parameterized query produces no finding", () => {
      const ctx = makeCtx(`db.query("SELECT * FROM users WHERE id = $1", [id]);`);
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("test file produces no finding", () => {
      const ctx = makeCtx(
        "db.query(`SELECT * FROM users WHERE id = ${id}`);",
        { filePath: "src/db.test.ts" },
      );
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("detects f-string in execute()", () => {
      const ctx = makeCtx(
        `cursor.execute(f"SELECT * FROM {table}")\n`,
        { language: "python" },
      );
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("sql-injection");
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("f-string");
    });

    test("parameterized Python query produces no finding", () => {
      const ctx = makeCtx(
        `cursor.execute("SELECT * FROM users WHERE id = %s", (id,))\n`,
        { language: "python" },
      );
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("test file produces no finding", () => {
      const ctx = makeCtx(
        `cursor.execute(f"SELECT * FROM {table}")\n`,
        { language: "python", filePath: "src/tests/test_db.py" },
      );
      const findings = sqlInjection.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
