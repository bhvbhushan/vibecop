import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { sleepyTest } from "../../src/detectors/sleepy-test.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

try {
  const req = createRequire(import.meta.url);
  const pythonLang = req("@ast-grep/lang-python") as {
    libraryPath: string;
    extensions: string[];
  };
  registerDynamicLanguage({ python: pythonLang });
} catch {}

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
  const defaultPath = `example.test.${extMap[language].slice(1)}`;
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

describe("sleepy-test", () => {
  test("detector has correct metadata", () => {
    expect(sleepyTest.id).toBe("sleepy-test");
    expect(sleepyTest.meta.severity).toBe("warning");
    expect(sleepyTest.meta.category).toBe("testing");
  });

  test("setTimeout in test file → finding", () => {
    const ctx = makeCtx(`
      test('waits', () => {
        setTimeout(() => {}, 1000);
      });
    `);
    const findings = sleepyTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("setTimeout(");
  });

  test("time.sleep in Python test → finding", () => {
    const ctx = makeCtx(
      `
def test_slow():
    time.sleep(2)
    assert True
`,
      { language: "python", filePath: "test_example.py" },
    );
    const findings = sleepyTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("time.sleep(");
  });

  test("setTimeout in non-test file → no finding", () => {
    const ctx = makeCtx(
      `setTimeout(() => {}, 1000);`,
      { filePath: "src/utils.ts" },
    );
    expect(sleepyTest.detect(ctx).length).toBe(0);
  });

  test("multiple sleep patterns detected", () => {
    const ctx = makeCtx(`
      test('waits', () => {
        setTimeout(() => {}, 100);
        setInterval(() => {}, 200);
      });
    `);
    const findings = sleepyTest.detect(ctx);
    expect(findings.length).toBe(2);
  });

  test("await sleep() detected", () => {
    const ctx = makeCtx(`
      test('waits', async () => {
        await sleep(1000);
      });
    `);
    const findings = sleepyTest.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("await sleep(");
  });
});
