import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { llmUnpinnedModel } from "../../src/detectors/llm-unpinned-model.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

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

describe("llm-unpinned-model", () => {
  test("detector has correct metadata", () => {
    expect(llmUnpinnedModel.id).toBe("llm-unpinned-model");
    expect(llmUnpinnedModel.meta.severity).toBe("warning");
    expect(llmUnpinnedModel.meta.category).toBe("quality");
    expect(llmUnpinnedModel.meta.priority).toBe(10);
  });

  test('flags "gpt-4o" as unpinned', () => {
    const ctx = makeCtx('const model = "gpt-4o";');
    const findings = llmUnpinnedModel.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("llm-unpinned-model");
    expect(findings[0].message).toContain("gpt-4o");
    expect(findings[0].message).toContain("Unpinned");
  });

  test('does NOT flag "gpt-4o-2024-08-06"', () => {
    const ctx = makeCtx('const model = "gpt-4o-2024-08-06";');
    const findings = llmUnpinnedModel.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test('flags "claude-3-5-sonnet-latest"', () => {
    const ctx = makeCtx('const model = "claude-3-5-sonnet-latest";');
    const findings = llmUnpinnedModel.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("claude-3-5-sonnet-latest");
  });

  test('does NOT flag "claude-3-5-sonnet-20241022"', () => {
    const ctx = makeCtx('const model = "claude-3-5-sonnet-20241022";');
    const findings = llmUnpinnedModel.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test('flags "gemini-pro"', () => {
    const ctx = makeCtx('const model = "gemini-pro";');
    const findings = llmUnpinnedModel.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("gemini-pro");
  });
});
