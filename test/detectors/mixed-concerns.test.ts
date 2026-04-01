import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { mixedConcerns } from "../../src/detectors/mixed-concerns.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: {
    language?: "typescript" | "javascript" | "tsx";
    filePath?: string;
  } = {},
): DetectionContext {
  const language = options.language ?? "typescript";
  const langMap: Record<string, Lang> = {
    typescript: Lang.TypeScript,
    javascript: Lang.JavaScript,
    tsx: Lang.Tsx,
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    javascript: ".js",
    tsx: ".tsx",
  };
  const defaultPath = `src/page.${extMap[language].slice(1)}`;
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

describe("mixed-concerns", () => {
  test("detector has correct metadata", () => {
    expect(mixedConcerns.id).toBe("mixed-concerns");
    expect(mixedConcerns.meta.severity).toBe("warning");
    expect(mixedConcerns.meta.category).toBe("quality");
    expect(mixedConcerns.meta.languages).toContain("typescript");
    expect(mixedConcerns.meta.languages).toContain("tsx");
  });

  test("file importing react and @prisma/client produces finding", () => {
    const ctx = makeCtx(`
      import React from "react";
      import { PrismaClient } from "@prisma/client";

      const prisma = new PrismaClient();
      export default function Page() { return null; }
    `);
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("mixed-concerns");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("react");
    expect(findings[0].message).toContain("@prisma/client");
    expect(findings[0].message).toContain("mixed concerns");
  });

  test("file importing only react produces no finding", () => {
    const ctx = makeCtx(`
      import React from "react";
      import { useState } from "react";

      export default function Page() { return null; }
    `);
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("file importing only @prisma/client produces no finding", () => {
    const ctx = makeCtx(`
      import { PrismaClient } from "@prisma/client";

      const prisma = new PrismaClient();
      export async function getUsers() { return prisma.user.findMany(); }
    `);
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("file in /api/ path produces no finding", () => {
    const ctx = makeCtx(
      `
      import React from "react";
      import { PrismaClient } from "@prisma/client";

      export default function handler() { return null; }
      `,
      { filePath: "src/api/users.ts" },
    );
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test('file with "use server" directive produces no finding', () => {
    const ctx = makeCtx(`
      "use server";
      import React from "react";
      import { PrismaClient } from "@prisma/client";

      export default function ServerAction() { return null; }
    `);
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("test file produces no finding", () => {
    const ctx = makeCtx(
      `
      import React from "react";
      import { PrismaClient } from "@prisma/client";

      export default function TestPage() { return null; }
      `,
      { filePath: "src/page.test.ts" },
    );
    const findings = mixedConcerns.detect(ctx);
    expect(findings.length).toBe(0);
  });
});
