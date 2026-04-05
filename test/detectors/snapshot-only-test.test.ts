import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { snapshotOnlyTest } from "../../src/detectors/snapshot-only-test.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: { filePath?: string } = {},
): DetectionContext {
  const filePath = options.filePath ?? "example.test.ts";
  const root = parse(Lang.TypeScript, source);
  const file: FileInfo = {
    path: filePath,
    absolutePath: `/${filePath}`,
    language: "typescript",
    extension: ".ts",
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("snapshot-only-test", () => {
  test("detector has correct metadata", () => {
    expect(snapshotOnlyTest.id).toBe("snapshot-only-test");
    expect(snapshotOnlyTest.meta.severity).toBe("info");
    expect(snapshotOnlyTest.meta.category).toBe("testing");
  });

  test("file with only toMatchSnapshot → finding", () => {
    const ctx = makeCtx(`
      test('renders', () => {
        expect(tree).toMatchSnapshot();
      });
      test('renders again', () => {
        expect(tree2).toMatchSnapshot();
      });
    `);
    const findings = snapshotOnlyTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("2 assertions");
    expect(findings[0].message).toContain("snapshots");
  });

  test("file with mix of snapshot + toBe → no finding", () => {
    const ctx = makeCtx(`
      test('renders', () => {
        expect(tree).toMatchSnapshot();
      });
      test('works', () => {
        expect(result).toBe(42);
      });
    `);
    expect(snapshotOnlyTest.detect(ctx).length).toBe(0);
  });

  test("file with zero assertions → no finding", () => {
    const ctx = makeCtx(`
      test('does nothing', () => {
        const x = 1;
      });
    `);
    expect(snapshotOnlyTest.detect(ctx).length).toBe(0);
  });

  test("non-test file → no finding", () => {
    const ctx = makeCtx(
      `expect(tree).toMatchSnapshot();`,
      { filePath: "src/utils.ts" },
    );
    expect(snapshotOnlyTest.detect(ctx).length).toBe(0);
  });

  test("toMatchInlineSnapshot also counted", () => {
    const ctx = makeCtx(`
      test('renders', () => {
        expect(tree).toMatchInlineSnapshot(\`<div />\`);
      });
    `);
    const findings = snapshotOnlyTest.detect(ctx);
    expect(findings.length).toBe(1);
  });
});
