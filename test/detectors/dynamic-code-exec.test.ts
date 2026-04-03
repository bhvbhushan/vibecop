import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { dynamicCodeExec } from "../../src/detectors/dynamic-code-exec.js";
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
  const defaultPath = `src/exec.${extMap[language].slice(1)}`;
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

describe("dynamic-code-exec", () => {
  test("detector has correct metadata", () => {
    expect(dynamicCodeExec.id).toBe("dynamic-code-exec");
    expect(dynamicCodeExec.meta.severity).toBe("error");
    expect(dynamicCodeExec.meta.category).toBe("security");
    expect(dynamicCodeExec.meta.priority).toBe(10);
  });

  describe("JavaScript/TypeScript", () => {
    test("flags eval(variable)", () => {
      const ctx = makeCtx("eval(userInput);");
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("dynamic-code-exec");
      expect(findings[0].message).toContain("eval()");
      expect(findings[0].message).toContain("dynamic argument");
    });

    test("does NOT flag eval(\"literal\")", () => {
      const ctx = makeCtx('eval("1 + 2");');
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("flags new Function(variable)", () => {
      const ctx = makeCtx("const fn = new Function(body);");
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("new Function()");
      expect(findings[0].message).toContain("dynamic argument");
    });

    test("does NOT flag new Function(\"literal\")", () => {
      const ctx = makeCtx('const fn = new Function("return 1");');
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("flags eval(variable)", () => {
      const ctx = makeCtx(
        `result = eval(user_input)\n`,
        { language: "python" },
      );
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("dynamic-code-exec");
      expect(findings[0].message).toContain("eval()");
    });

    test("does NOT flag eval(\"literal\")", () => {
      const ctx = makeCtx(
        `result = eval("1 + 2")\n`,
        { language: "python" },
      );
      const findings = dynamicCodeExec.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
