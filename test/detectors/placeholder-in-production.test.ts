import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { placeholderInProduction } from "../../src/detectors/placeholder-in-production.js";
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
  const defaultPath = `src/config.${extMap[language].slice(1)}`;
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

describe("placeholder-in-production", () => {
  test("detector has correct metadata", () => {
    expect(placeholderInProduction.id).toBe("placeholder-in-production");
    expect(placeholderInProduction.meta.severity).toBe("error");
    expect(placeholderInProduction.meta.category).toBe("security");
    expect(placeholderInProduction.meta.languages).toContain("typescript");
    expect(placeholderInProduction.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects domain: 'yourdomain.com'", () => {
      const ctx = makeCtx(`const config = { domain: "yourdomain.com" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("placeholder-in-production");
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("placeholder");
    });

    test("detects password: 'changeme'", () => {
      const ctx = makeCtx(`const config = { password: "changeme" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("placeholder");
    });

    test("does NOT flag HTML placeholder attribute", () => {
      const ctx = makeCtx(`const input = { placeholder: "https://example.com" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in test file", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "src/config.test.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in __tests__ directory", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "src/__tests__/config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in comment", () => {
      const ctx = makeCtx(`
        // Set domain to "yourdomain.com" in production
        const config = { domain: process.env.DOMAIN };
      `);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects 'your_api_key' placeholder credential", () => {
      const ctx = makeCtx(`const config = { key: "your_api_key" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("placeholder");
    });

    test("detects 'REPLACE_ME' placeholder", () => {
      const ctx = makeCtx(`const config = { secret: "REPLACE_ME" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
    });

    test("detects example.com in URL config", () => {
      const ctx = makeCtx(`const config = { url: "https://example.com/api" };`);
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
    });
  });

  describe("fixture/example/mock directory skipping", () => {
    test("does NOT flag placeholder in fixtures/ directory", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "test/fixtures/config-data.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in __fixtures__/ directory", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "src/__fixtures__/mock-config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in examples/ directory", () => {
      const ctx = makeCtx(
        `const config = { url: "https://example.com/api" };`,
        { filePath: "examples/basic-setup.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in example/ directory", () => {
      const ctx = makeCtx(
        `const config = { key: "your_api_key" };`,
        { filePath: "example/config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in samples/ directory", () => {
      const ctx = makeCtx(
        `const config = { password: "changeme" };`,
        { filePath: "samples/auth-config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in mocks/ directory", () => {
      const ctx = makeCtx(
        `const config = { token: "your_token" };`,
        { filePath: "src/mocks/api-responses.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in stubs/ directory", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "test/stubs/config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in demo/ directory", () => {
      const ctx = makeCtx(
        `const config = { password: "changeme" };`,
        { filePath: "demo/setup.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in .fixture.ts file", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "src/config.fixture.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in .example.ts file", () => {
      const ctx = makeCtx(
        `const config = { key: "your_api_key" };`,
        { filePath: "src/config.example.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in .example file", () => {
      const ctx = makeCtx(
        `SECRET_KEY="changeme"`,
        { filePath: ".env.example" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag placeholder in .md file", () => {
      const ctx = makeCtx(
        `Set your url to "https://example.com/api"`,
        { filePath: "docs/setup.md" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("STILL flags placeholder in regular src/ file", () => {
      const ctx = makeCtx(
        `const config = { domain: "yourdomain.com" };`,
        { filePath: "src/config.ts" },
      );
      const findings = placeholderInProduction.detect(ctx);
      expect(findings.length).toBe(1);
    });
  });
});
