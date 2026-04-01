import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { unboundedQuery } from "../../src/detectors/unbounded-query.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: {
    language?: "typescript" | "javascript";
    filePath?: string;
  } = {},
): DetectionContext {
  const language = options.language ?? "typescript";
  const langMap: Record<string, Lang> = {
    typescript: Lang.TypeScript,
    javascript: Lang.JavaScript,
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    javascript: ".js",
  };
  const defaultPath = `src/repo.${extMap[language].slice(1)}`;
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

describe("unbounded-query", () => {
  test("detector has correct metadata", () => {
    expect(unboundedQuery.id).toBe("unbounded-query");
    expect(unboundedQuery.meta.severity).toBe("info");
    expect(unboundedQuery.meta.category).toBe("quality");
    expect(unboundedQuery.meta.languages).toContain("typescript");
  });

  test("prisma.user.findMany() without take produces finding", () => {
    const ctx = makeCtx(`const users = await prisma.user.findMany();`);
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("unbounded-query");
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("without a limit");
  });

  test("prisma.user.findMany({ take: 10 }) produces no finding", () => {
    const ctx = makeCtx(`const users = await prisma.user.findMany({ take: 10 });`);
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("prisma.user.findMany({ where: {} }) without take produces finding", () => {
    const ctx = makeCtx(`const users = await prisma.user.findMany({ where: { active: true } });`);
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("unbounded-query");
    expect(findings[0].message).toContain("without a limit");
  });

  test("db.find().limit(10) produces no finding", () => {
    const ctx = makeCtx(`const docs = await db.find().limit(10);`);
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("findOne() produces no finding (single record)", () => {
    const ctx = makeCtx(`const user = await prisma.user.findOne({ where: { id: 1 } });`);
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("test file produces no finding", () => {
    const ctx = makeCtx(
      `const users = await prisma.user.findMany();`,
      { filePath: "src/repo.test.ts" },
    );
    const findings = unboundedQuery.detect(ctx);
    expect(findings.length).toBe(0);
  });
});
