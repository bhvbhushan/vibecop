import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { excessiveAny } from "../../src/detectors/excessive-any.js";
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

describe("excessive-any", () => {
  test("detector has correct metadata", () => {
    expect(excessiveAny.id).toBe("excessive-any");
    expect(excessiveAny.meta.severity).toBe("warning");
    expect(excessiveAny.meta.category).toBe("quality");
    expect(excessiveAny.meta.languages).toContain("typescript");
    expect(excessiveAny.meta.languages).toContain("tsx");
  });

  test("flags file with 5 any annotations (exceeds threshold of 3)", () => {
    const ctx = makeCtx(`
      function a(x: any): any {
        const b: any = 1;
        const c: any = 2;
        return x as any;
      }
    `);
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBeGreaterThanOrEqual(5);
    expect(findings[0].detectorId).toBe("excessive-any");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("any");
  });

  test("does NOT flag file with 2 any annotations (below threshold)", () => {
    const ctx = makeCtx(`
      function a(x: any): string {
        const b: any = 1;
        return "ok";
      }
    `);
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag file with exactly 3 any annotations (at threshold)", () => {
    const ctx = makeCtx(`
      function a(x: any): any {
        const b: any = 1;
        return "ok";
      }
    `);
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag test file with many any annotations", () => {
    const ctx = makeCtx(
      `
      function a(x: any): any {
        const b: any = 1;
        const c: any = 2;
        return x as any;
      }
    `,
      { filePath: "src/utils.test.ts" },
    );
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag __tests__ directory", () => {
    const ctx = makeCtx(
      `
      function a(x: any): any {
        const b: any = 1;
        const c: any = 2;
        return x as any;
      }
    `,
      { filePath: "src/__tests__/utils.ts" },
    );
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag .d.ts files", () => {
    const ctx = makeCtx(
      `
      declare function a(x: any): any;
      declare const b: any;
      declare const c: any;
      declare const d: any;
    `,
      { filePath: "src/types.d.ts" },
    );
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT run on JavaScript files", () => {
    const root = parse(Lang.JavaScript, `function a(x) { return x; }`);
    const file: FileInfo = {
      path: "src/app.js",
      absolutePath: "/src/app.js",
      language: "javascript",
      extension: ".js",
    };
    const ctx: DetectionContext = {
      file,
      root,
      source: `function a(x) { return x; }`,
      project: EMPTY_PROJECT,
      config: {},
    };
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("message includes count of any usages", () => {
    const ctx = makeCtx(`
      function a(x: any): any {
        const b: any = 1;
        const c: any = 2;
        return x as any;
      }
    `);
    const findings = excessiveAny.detect(ctx);
    expect(findings.length).toBeGreaterThan(0);
    // Each finding message should contain the total count
    expect(findings[0].message).toMatch(/\d+/);
    expect(findings[0].message).toContain("any");
  });
});
