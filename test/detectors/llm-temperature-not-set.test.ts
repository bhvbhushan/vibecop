import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { llmTemperatureNotSet } from "../../src/detectors/llm-temperature-not-set.js";
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

describe("llm-temperature-not-set", () => {
  test("detector has correct metadata", () => {
    expect(llmTemperatureNotSet.id).toBe("llm-temperature-not-set");
    expect(llmTemperatureNotSet.meta.severity).toBe("info");
    expect(llmTemperatureNotSet.meta.category).toBe("quality");
    expect(llmTemperatureNotSet.meta.priority).toBe(10);
  });

  describe("JavaScript/TypeScript", () => {
    test("flags .create() call without temperature", () => {
      const ctx = makeCtx(`
        client.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 1000,
        });
      `);
      const findings = llmTemperatureNotSet.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("llm-temperature-not-set");
      expect(findings[0].message).toContain("temperature");
    });

    test("does NOT flag .create({ temperature: 0.7 })", () => {
      const ctx = makeCtx(`
        client.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          temperature: 0.7,
        });
      `);
      const findings = llmTemperatureNotSet.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("works with Anthropic messages.create pattern", () => {
      const ctx = makeCtx(`
        client.messages.create({
          model: "claude-3-opus",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 1000,
        });
      `);
      const findings = llmTemperatureNotSet.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("temperature");
    });
  });

  describe("Python", () => {
    test("flags create() without temperature", () => {
      const ctx = makeCtx(
        `client.chat.completions.create(model="gpt-4", messages=msgs, max_tokens=1000)\n`,
        { language: "python" },
      );
      const findings = llmTemperatureNotSet.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("temperature");
    });

    test("does NOT flag create(temperature=0.7)", () => {
      const ctx = makeCtx(
        `client.chat.completions.create(model="gpt-4", messages=msgs, temperature=0.7)\n`,
        { language: "python" },
      );
      const findings = llmTemperatureNotSet.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
