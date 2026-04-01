import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { insecureDefaults } from "../../src/detectors/insecure-defaults.js";
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

describe("insecure-defaults", () => {
  test("detector has correct metadata", () => {
    expect(insecureDefaults.id).toBe("insecure-defaults");
    expect(insecureDefaults.meta.severity).toBe("error");
    expect(insecureDefaults.meta.category).toBe("security");
    expect(insecureDefaults.meta.languages).toContain("typescript");
    expect(insecureDefaults.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    describe("rejectUnauthorized: false", () => {
      test("detects rejectUnauthorized: false", () => {
        const ctx = makeCtx(`const opts = { rejectUnauthorized: false };`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("rejectUnauthorized"),
        );
        expect(relevant.length).toBe(1);
        expect(relevant[0].severity).toBe("error");
      });

      test("does NOT flag rejectUnauthorized: true", () => {
        const ctx = makeCtx(`const opts = { rejectUnauthorized: true };`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("rejectUnauthorized"),
        );
        expect(relevant.length).toBe(0);
      });
    });

    describe("eval", () => {
      test("detects eval() usage", () => {
        const ctx = makeCtx(`const result = eval("1 + 2");`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) => f.message.includes("eval"));
        expect(relevant.length).toBe(1);
      });
    });

    describe("new Function", () => {
      test("detects new Function() usage", () => {
        const ctx = makeCtx(`const fn = new Function("return 1");`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("new Function"),
        );
        expect(relevant.length).toBe(1);
      });
    });

    describe("hardcoded credentials", () => {
      test("detects hardcoded password", () => {
        const ctx = makeCtx(`const password = "super_secret";`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(1);
        expect(relevant[0].message).toContain("password");
      });

      test("detects hardcoded api_key", () => {
        const ctx = makeCtx(`const api_key = "sk-12345";`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(1);
      });

      test("detects hardcoded token", () => {
        const ctx = makeCtx(`const auth_token = "Bearer abc123";`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(1);
      });

      test("detects hardcoded secret in object property", () => {
        const ctx = makeCtx(`const config = { password: "secret123" };`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(1);
      });

      test("does NOT flag password from environment variable", () => {
        const ctx = makeCtx(`const password = process.env.PASSWORD;`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(0);
      });

      test("does NOT flag empty string password", () => {
        const ctx = makeCtx(`const password = "";`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(0);
      });

      test("does NOT flag non-credential variable names", () => {
        const ctx = makeCtx(`const username = "admin";`);
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Hardcoded credential"),
        );
        expect(relevant.length).toBe(0);
      });
    });

    describe("weak ciphers", () => {
      test("detects weak cipher (des)", () => {
        const ctx = makeCtx(
          `const cipher = crypto.createCipheriv("des", key, iv);`,
        );
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Weak cipher"),
        );
        expect(relevant.length).toBe(1);
        expect(relevant[0].message).toContain("des");
      });

      test("does NOT flag strong cipher (aes-256-gcm)", () => {
        const ctx = makeCtx(
          `const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);`,
        );
        const findings = insecureDefaults.detect(ctx);
        const relevant = findings.filter((f) =>
          f.message.includes("Weak cipher"),
        );
        expect(relevant.length).toBe(0);
      });
    });

    test("detects multiple insecure patterns in one file", () => {
      const ctx = makeCtx(`
        const opts = { rejectUnauthorized: false };
        const result = eval("code");
        const password = "secret";
      `);
      const findings = insecureDefaults.detect(ctx);
      expect(findings.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Python", () => {
    test("detects verify=False", () => {
      const ctx = makeCtx(
        `requests.get("http://example.com", verify=False)\n`,
        "python",
      );
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) =>
        f.message.includes("verify=False"),
      );
      expect(relevant.length).toBe(1);
    });

    test("detects shell=True", () => {
      const ctx = makeCtx(
        `subprocess.run(["ls"], shell=True)\n`,
        "python",
      );
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) =>
        f.message.includes("shell=True"),
      );
      expect(relevant.length).toBe(1);
    });

    test("detects eval() in Python", () => {
      const ctx = makeCtx(`result = eval("1 + 2")\n`, "python");
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) => f.message.includes("eval"));
      expect(relevant.length).toBe(1);
    });

    test("detects hardcoded password in Python", () => {
      const ctx = makeCtx(`password = "secret123"\n`, "python");
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) =>
        f.message.includes("Hardcoded credential"),
      );
      expect(relevant.length).toBe(1);
    });

    test("does NOT flag password from env in Python", () => {
      const ctx = makeCtx(
        `password = os.environ["PASSWORD"]\n`,
        "python",
      );
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) =>
        f.message.includes("Hardcoded credential"),
      );
      expect(relevant.length).toBe(0);
    });

    test("does NOT flag empty string password in Python", () => {
      const ctx = makeCtx(`password = ""\n`, "python");
      const findings = insecureDefaults.detect(ctx);
      const relevant = findings.filter((f) =>
        f.message.includes("Hardcoded credential"),
      );
      expect(relevant.length).toBe(0);
    });
  });
});
