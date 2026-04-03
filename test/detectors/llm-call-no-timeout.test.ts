import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { llmCallNoTimeout } from "../../src/detectors/llm-call-no-timeout.js";
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
  const defaultPath = `src/llm.${extMap[language].slice(1)}`;
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

describe("llm-call-no-timeout", () => {
  test("detector has correct metadata", () => {
    expect(llmCallNoTimeout.id).toBe("llm-call-no-timeout");
    expect(llmCallNoTimeout.meta.severity).toBe("warning");
    expect(llmCallNoTimeout.meta.category).toBe("quality");
    expect(llmCallNoTimeout.meta.priority).toBe(10);
  });

  describe("JavaScript/TypeScript", () => {
    test("flags new OpenAI() with no args", () => {
      const ctx = makeCtx("const client = new OpenAI();");
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("timeout");
    });

    test("flags new OpenAI({}) without timeout", () => {
      const ctx = makeCtx('const client = new OpenAI({ apiKey: "sk-123" });');
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("timeout");
    });

    test("does NOT flag new OpenAI({ timeout: 30000 })", () => {
      const ctx = makeCtx("const client = new OpenAI({ timeout: 30000 });");
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("flags new Anthropic() without timeout", () => {
      const ctx = makeCtx('const client = new Anthropic({ apiKey: "key" });');
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("timeout");
    });

    test("does NOT flag new Anthropic({ timeout: 30000 })", () => {
      const ctx = makeCtx("const client = new Anthropic({ timeout: 30000 });");
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("flags .create() without max_tokens", () => {
      const ctx = makeCtx(`
        client.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
        });
      `);
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("max_tokens");
    });

    test("does NOT flag .create({ max_tokens: 1000 })", () => {
      const ctx = makeCtx(`
        client.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 1000,
        });
      `);
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("flags create() without timeout", () => {
      const ctx = makeCtx(
        `client.chat.completions.create(model="gpt-4", messages=[{"role": "user", "content": "hi"}])\n`,
        { language: "python" },
      );
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("timeout");
    });

    test("does NOT flag create(timeout=30)", () => {
      const ctx = makeCtx(
        `client.chat.completions.create(model="gpt-4", messages=msgs, timeout=30)\n`,
        { language: "python" },
      );
      const findings = llmCallNoTimeout.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
