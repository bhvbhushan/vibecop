import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { dangerousInnerHtml } from "../../src/detectors/dangerous-inner-html.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: {
    language?: "typescript" | "tsx";
    filePath?: string;
  } = {},
): DetectionContext {
  const language = options.language ?? "tsx";
  const langMap: Record<string, Lang> = {
    typescript: Lang.TypeScript,
    tsx: Lang.Tsx,
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    tsx: ".tsx",
  };
  const defaultPath = `src/Component.${extMap[language].slice(1)}`;
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

describe("dangerous-inner-html", () => {
  test("detector has correct metadata", () => {
    expect(dangerousInnerHtml.id).toBe("dangerous-inner-html");
    expect(dangerousInnerHtml.meta.severity).toBe("warning");
    expect(dangerousInnerHtml.meta.category).toBe("security");
    expect(dangerousInnerHtml.meta.languages).toContain("tsx");
  });

  test("detects dangerouslySetInnerHTML usage", () => {
    const ctx = makeCtx(
      `export function Comp() { return <div dangerouslySetInnerHTML={{__html: content}} />; }`,
    );
    const findings = dangerousInnerHtml.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("dangerous-inner-html");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("dangerouslySetInnerHTML");
    expect(findings[0].message).toContain("XSS");
  });

  test("normal JSX produces no finding", () => {
    const ctx = makeCtx(
      `export function Comp() { return <div>{content}</div>; }`,
    );
    const findings = dangerousInnerHtml.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("non-TSX file produces no finding", () => {
    const ctx = makeCtx(
      `const html = '<div>test</div>';`,
      { language: "typescript" },
    );
    const findings = dangerousInnerHtml.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("test file produces no finding", () => {
    const ctx = makeCtx(
      `export function Comp() { return <div dangerouslySetInnerHTML={{__html: content}} />; }`,
      { filePath: "src/Component.test.tsx" },
    );
    const findings = dangerousInnerHtml.detect(ctx);
    expect(findings.length).toBe(0);
  });
});
