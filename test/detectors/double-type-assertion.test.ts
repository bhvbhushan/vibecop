import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { doubleTypeAssertion } from "../../src/detectors/double-type-assertion.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: {
    filePath?: string;
    language?: "typescript" | "tsx";
  } = {},
): DetectionContext {
  const language = options.language ?? "typescript";
  const langMap: Record<string, Lang> = {
    typescript: Lang.TypeScript,
    tsx: Lang.Tsx,
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    tsx: ".tsx",
  };
  const defaultPath = `src/app.${extMap[language].slice(1)}`;
  const filePath = options.filePath ?? defaultPath;
  const root = parse(langMap[language], source);
  const file: FileInfo = {
    path: filePath,
    absolutePath: `/${filePath}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("double-type-assertion", () => {
  test("detector has correct metadata", () => {
    expect(doubleTypeAssertion.id).toBe("double-type-assertion");
    expect(doubleTypeAssertion.meta.severity).toBe("warning");
    expect(doubleTypeAssertion.meta.category).toBe("quality");
    expect(doubleTypeAssertion.meta.languages).toContain("typescript");
    expect(doubleTypeAssertion.meta.languages).toContain("tsx");
  });

  test("detects x as unknown as Y", () => {
    const ctx = makeCtx(`const x = value as unknown as string;`);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("double-type-assertion");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("Double type assertion");
  });

  test("detects x as any as Y", () => {
    const ctx = makeCtx(`const x = value as any as number;`);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("Double type assertion");
  });

  test("does NOT flag single assertion x as Y", () => {
    const ctx = makeCtx(`const x = value as string;`);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag double assertion in test file", () => {
    const ctx = makeCtx(
      `const x = value as unknown as string;`,
      { filePath: "src/utils.test.ts" },
    );
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag double assertion in __tests__ directory", () => {
    const ctx = makeCtx(
      `const x = value as unknown as string;`,
      { filePath: "src/__tests__/utils.ts" },
    );
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag double assertion in comment", () => {
    const ctx = makeCtx(`
      // This is an example: value as unknown as string
      const x = 42;
    `);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag double assertion in spec file", () => {
    const ctx = makeCtx(
      `const x = value as unknown as string;`,
      { filePath: "src/utils.spec.ts" },
    );
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT run on JavaScript files", () => {
    // The detector only works on typescript/tsx, so creating a JS context should be ignored
    const root = parse(Lang.JavaScript, `const x = value;`);
    const file: FileInfo = {
      path: "src/app.js",
      absolutePath: "/src/app.js",
      language: "javascript",
      extension: ".js",
    };
    const ctx: DetectionContext = { file, root, source: `const x = value;`, project: EMPTY_PROJECT, config: {} };
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag string containing 'as unknown as'", () => {
    const ctx = makeCtx(`const s = "cast as unknown as string";`);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("detects multiple double assertions in one file", () => {
    const ctx = makeCtx(`
      const a = val1 as unknown as string;
      const b = val2 as any as number;
    `);
    const findings = doubleTypeAssertion.detect(ctx);
    expect(findings.length).toBe(2);
  });
});
