import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { llmNoSystemMessage } from "../../src/detectors/llm-no-system-message.js";
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

describe("llm-no-system-message", () => {
  test("detector has correct metadata", () => {
    expect(llmNoSystemMessage.id).toBe("llm-no-system-message");
    expect(llmNoSystemMessage.meta.severity).toBe("info");
    expect(llmNoSystemMessage.meta.category).toBe("quality");
    expect(llmNoSystemMessage.meta.priority).toBe(10);
  });

  describe("JavaScript/TypeScript", () => {
    test("flags messages array with only user role", () => {
      const ctx = makeCtx(`
        const response = await client.chat.completions.create({
          model: "gpt-4",
          messages: [
            { role: "user", content: "Hello" }
          ],
        });
      `);
      const findings = llmNoSystemMessage.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].detectorId).toBe("llm-no-system-message");
      expect(findings[0].message).toContain("no system message");
    });

    test("flags messages with user + assistant but no system", () => {
      const ctx = makeCtx(`
        const opts = {
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
          ],
        };
      `);
      const findings = llmNoSystemMessage.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("no system message");
    });

    test("does NOT flag messages with system role present", () => {
      const ctx = makeCtx(`
        const opts = {
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hello" },
          ],
        };
      `);
      const findings = llmNoSystemMessage.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag when messages is a variable", () => {
      const ctx = makeCtx(`
        const opts = {
          messages: existingMessages,
        };
      `);
      const findings = llmNoSystemMessage.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("flags messages list without system role", () => {
      const ctx = makeCtx(
        `client.chat.completions.create(model="gpt-4", messages=[{"role": "user", "content": "hi"}])\n`,
        { language: "python" },
      );
      const findings = llmNoSystemMessage.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("no system message");
    });
  });
});
