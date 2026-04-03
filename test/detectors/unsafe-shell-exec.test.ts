import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { unsafeShellExec } from "../../src/detectors/unsafe-shell-exec.js";
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
  const defaultPath = `src/run.${extMap[language].slice(1)}`;
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

describe("unsafe-shell-exec", () => {
  test("detector has correct metadata", () => {
    expect(unsafeShellExec.id).toBe("unsafe-shell-exec");
    expect(unsafeShellExec.meta.severity).toBe("error");
    expect(unsafeShellExec.meta.category).toBe("security");
    expect(unsafeShellExec.meta.priority).toBe(10);
  });

  describe("JavaScript/TypeScript", () => {
    test("flags exec() with template literal", () => {
      const ctx = makeCtx("exec(`rm -rf ${dir}`);");
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("unsafe-shell-exec");
      expect(findings[0].severity).toBe("error");
      expect(findings[0].message).toContain("dynamic argument");
    });

    test("flags exec() with variable argument", () => {
      const ctx = makeCtx("exec(userInput);");
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("dynamic argument");
    });

    test("does NOT flag exec() with string literal", () => {
      const ctx = makeCtx('exec("ls -la");');
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("flags execSync() with template literal", () => {
      const ctx = makeCtx("execSync(`npm install ${pkg}`);");
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("dynamic argument");
    });

    test("does NOT flag execSync() with string literal", () => {
      const ctx = makeCtx('execSync("npm install");');
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("flags subprocess.run with shell=True and f-string", () => {
      const ctx = makeCtx(
        `subprocess.run(f"rm -rf {dir}", shell=True)\n`,
        { language: "python" },
      );
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("unsafe-shell-exec");
      expect(findings[0].message).toContain("shell=True");
    });

    test("flags subprocess.call with shell=True and variable", () => {
      const ctx = makeCtx(
        `subprocess.call(cmd, shell=True)\n`,
        { language: "python" },
      );
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("shell=True");
    });

    test("does NOT flag subprocess.run with shell=True and literal string", () => {
      const ctx = makeCtx(
        `subprocess.run("ls -la", shell=True)\n`,
        { language: "python" },
      );
      const findings = unsafeShellExec.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
