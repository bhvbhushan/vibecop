import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { tokenInLocalstorage } from "../../src/detectors/token-in-localstorage.js";
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
    language?: "typescript" | "javascript";
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
  const defaultPath = `src/auth.${extMap[language].slice(1)}`;
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

describe("token-in-localstorage", () => {
  test("detector has correct metadata", () => {
    expect(tokenInLocalstorage.id).toBe("token-in-localstorage");
    expect(tokenInLocalstorage.meta.severity).toBe("error");
    expect(tokenInLocalstorage.meta.category).toBe("security");
    expect(tokenInLocalstorage.meta.languages).toContain("typescript");
    expect(tokenInLocalstorage.meta.languages).toContain("javascript");
  });

  test('detects localStorage.setItem("token", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("token", authToken);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("token-in-localstorage");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("localStorage");
    expect(findings[0].message).toContain("XSS");
  });

  test('detects localStorage.setItem("jwt", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("jwt", jwtToken);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("localStorage");
  });

  test('does NOT flag localStorage.setItem("theme", value) — not sensitive', () => {
    const ctx = makeCtx(`localStorage.setItem("theme", "dark");`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test('does NOT flag localStorage.setItem("language", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("language", "en");`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test('detects sessionStorage.setItem("auth_token", value)', () => {
    const ctx = makeCtx(`sessionStorage.setItem("auth_token", token);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("sessionStorage");
    expect(findings[0].message).toContain("XSS");
  });

  test('detects localStorage.setItem("access_token", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("access_token", accessToken);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
  });

  test('detects localStorage.setItem("refresh_token", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("refresh_token", refreshToken);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
  });

  test("does NOT flag in test file", () => {
    const ctx = makeCtx(
      `localStorage.setItem("token", "test-token");`,
      { filePath: "src/auth.test.ts" },
    );
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag in __tests__ directory", () => {
    const ctx = makeCtx(
      `localStorage.setItem("token", "test-token");`,
      { filePath: "src/__tests__/auth.ts" },
    );
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("detects multiple token storage calls", () => {
    const ctx = makeCtx(`
      localStorage.setItem("token", authToken);
      sessionStorage.setItem("jwt", jwtValue);
      localStorage.setItem("theme", "dark");
    `);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(2);
  });

  test('detects localStorage.setItem("session", value)', () => {
    const ctx = makeCtx(`localStorage.setItem("session", sessionId);`);
    const findings = tokenInLocalstorage.detect(ctx);
    expect(findings.length).toBe(1);
  });
});
