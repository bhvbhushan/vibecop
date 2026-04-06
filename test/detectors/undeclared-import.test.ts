import { describe, expect, test } from "bun:test";
import { parse, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { undeclaredImport } from "../../src/detectors/undeclared-import.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

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

const PROJECT_WITH_DEPS: ProjectInfo = {
  dependencies: new Set(["express", "lodash", "@scope/pkg"]),
  devDependencies: new Set(["jest", "typescript"]),
  manifests: ["package.json"],
};

const EMPTY_PROJECT_WITH_MANIFEST: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: ["package.json"],
};

const NO_MANIFEST_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

const PYTHON_PROJECT: ProjectInfo = {
  dependencies: new Set(["flask", "requests"]),
  devDependencies: new Set(),
  manifests: ["requirements.txt"],
};

function makeCtx(
  source: string,
  project: ProjectInfo,
  language: "typescript" | "javascript" | "python" = "typescript",
  options?: { filePath?: string; absolutePath?: string },
): DetectionContext {
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
  const defaultRelPath = `src/app.${extMap[language].slice(1)}`;
  const root = parse(langMap[language] as Lang, source);
  const file: FileInfo = {
    path: options?.filePath ?? defaultRelPath,
    absolutePath: options?.absolutePath ?? `/${options?.filePath ?? defaultRelPath}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project, config: {} };
}

describe("undeclared-import", () => {
  test("detector has correct metadata", () => {
    expect(undeclaredImport.id).toBe("undeclared-import");
    expect(undeclaredImport.meta.severity).toBe("error");
    expect(undeclaredImport.meta.category).toBe("correctness");
    expect(undeclaredImport.meta.languages).toContain("typescript");
    expect(undeclaredImport.meta.languages).toContain("python");
  });

  describe("JavaScript/TypeScript", () => {
    test("detects import of package not in dependencies", () => {
      const ctx = makeCtx(
        `import axios from 'axios';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("axios");
      expect(findings[0].message).toContain("not declared");
    });

    test("does NOT flag packages that ARE in dependencies", () => {
      const ctx = makeCtx(
        `import express from 'express';`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag packages in devDependencies", () => {
      const ctx = makeCtx(
        `import jest from 'jest';`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag relative imports", () => {
      const ctx = makeCtx(
        `import { foo } from './foo';\nimport { bar } from '../bar';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag Node builtins (fs, path, etc.)", () => {
      const ctx = makeCtx(
        `import fs from 'fs';\nimport path from 'path';\nimport crypto from 'crypto';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag node: protocol imports", () => {
      const ctx = makeCtx(
        `import fs from 'node:fs';\nimport path from 'node:path';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("handles scoped packages (@scope/pkg)", () => {
      const ctx = makeCtx(
        `import pkg from '@scope/pkg';`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects undeclared scoped packages", () => {
      const ctx = makeCtx(
        `import pkg from '@other/lib';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("@other/lib");
    });

    test("handles subpath imports (lodash/merge -> lodash)", () => {
      const ctx = makeCtx(
        `import merge from 'lodash/merge';`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("handles scoped subpath imports (@scope/pkg/sub -> @scope/pkg)", () => {
      const ctx = makeCtx(
        `import sub from '@scope/pkg/sub/path';`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("does NOT flag path aliases (@/ and ~/)", () => {
      const ctx = makeCtx(
        `import { utils } from '@/utils';\nimport { config } from '~/config';`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects require() calls with undeclared packages", () => {
      const ctx = makeCtx(
        `const axios = require('axios');`,
        EMPTY_PROJECT_WITH_MANIFEST,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("axios");
    });

    test("does NOT flag require() with declared packages", () => {
      const ctx = makeCtx(
        `const express = require('express');`,
        PROJECT_WITH_DEPS,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("skips when no manifests found", () => {
      const ctx = makeCtx(
        `import axios from 'axios';`,
        NO_MANIFEST_PROJECT,
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("Python", () => {
    test("detects undeclared import", () => {
      const ctx = makeCtx(
        `import numpy\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("numpy");
    });

    test("does NOT flag declared packages", () => {
      const ctx = makeCtx(
        `import flask\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("skips Python builtins", () => {
      const ctx = makeCtx(
        `import os\nimport sys\nimport json\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("handles from X.Y import Z (extracts top-level)", () => {
      const ctx = makeCtx(
        `from flask.views import View\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("detects undeclared from-import", () => {
      const ctx = makeCtx(
        `from pandas import DataFrame\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(1);
      expect(findings[0].message).toContain("pandas");
    });

    test("skips relative imports", () => {
      const ctx = makeCtx(
        `from . import utils\nfrom ..module import helper\n`,
        PYTHON_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("skips when no manifests found", () => {
      const ctx = makeCtx(
        `import numpy\n`,
        NO_MANIFEST_PROJECT,
        "python",
      );
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });

  describe("self-referencing package imports", () => {
    test("JS/TS: does NOT flag import of own package name", () => {
      // Create a temp directory with a package.json
      const tmp = mkdtempSync(join(tmpdir(), "vibecop-test-"));
      const srcDir = join(tmp, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(tmp, "package.json"), JSON.stringify({
        name: "my-cool-package",
        dependencies: {},
      }));

      const project: ProjectInfo = {
        dependencies: new Set(),
        devDependencies: new Set(),
        manifests: ["package.json"],
      };

      const source = `import { helper } from 'my-cool-package';`;
      const root = parse(Lang.TypeScript, source);
      const file: FileInfo = {
        path: "src/utils.ts",
        absolutePath: join(tmp, "src/utils.ts"),
        language: "typescript",
        extension: ".ts",
      };
      const ctx: DetectionContext = { file, root, source, project, config: {} };
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("JS/TS: does NOT flag require() of own package name", () => {
      const tmp = mkdtempSync(join(tmpdir(), "vibecop-test-"));
      const srcDir = join(tmp, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(tmp, "package.json"), JSON.stringify({
        name: "@my-org/my-lib",
        dependencies: {},
      }));

      const project: ProjectInfo = {
        dependencies: new Set(),
        devDependencies: new Set(),
        manifests: ["package.json"],
      };

      const source = `const lib = require('@my-org/my-lib');`;
      const root = parse(Lang.TypeScript, source);
      const file: FileInfo = {
        path: "src/index.ts",
        absolutePath: join(tmp, "src/index.ts"),
        language: "typescript",
        extension: ".ts",
      };
      const ctx: DetectionContext = { file, root, source, project, config: {} };
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });

    test("Python: does NOT flag import of own package with hyphens", () => {
      // Create a temp directory simulating mcp-atlassian project
      const tmp = mkdtempSync(join(tmpdir(), "vibecop-test-"));
      const srcDir = join(tmp, "src");
      const pkgDir = join(tmp, "src", "mcp_atlassian");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "__init__.py"), "");
      writeFileSync(join(tmp, "pyproject.toml"), [
        "[project]",
        'name = "mcp-atlassian"',
        "dependencies = []",
      ].join("\n"));

      const project: ProjectInfo = {
        dependencies: new Set(),
        devDependencies: new Set(),
        manifests: ["pyproject.toml"],
      };

      const source = `import mcp_atlassian\n`;
      const root = parse("python" as Lang, source);
      const file: FileInfo = {
        path: "src/app.py",
        absolutePath: join(tmp, "src/app.py"),
        language: "python",
        extension: ".py",
      };
      const ctx: DetectionContext = { file, root, source, project, config: {} };
      const findings = undeclaredImport.detect(ctx);
      expect(findings.length).toBe(0);
    });
  });
});
