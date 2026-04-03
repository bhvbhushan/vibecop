import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { hallucinatedPackage } from "../../src/detectors/hallucinated-package.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  filePath = "package.json",
): DetectionContext {
  // ast-grep can't parse JSON, but the detector ignores root anyway.
  // Parse a trivial JS string to satisfy the type.
  const root = parse(Lang.JavaScript, "0");
  const file: FileInfo = {
    path: filePath,
    absolutePath: `/${filePath}`,
    language: "javascript",
    extension: ".json",
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

describe("hallucinated-package", () => {
  test("detector has correct metadata", () => {
    expect(hallucinatedPackage.id).toBe("hallucinated-package");
    expect(hallucinatedPackage.meta.severity).toBe("info");
    expect(hallucinatedPackage.meta.category).toBe("correctness");
    expect(hallucinatedPackage.meta.languages).toContain("javascript");
    expect(hallucinatedPackage.meta.languages).toContain("typescript");
    expect(hallucinatedPackage.meta.priority).toBe(10);
  });

  test("flags unknown package in dependencies", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        dependencies: {
          "totally-fake-nonexistent-pkg-xyz": "^1.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("totally-fake-nonexistent-pkg-xyz");
    expect(findings[0].message).toContain("not in the known-packages allowlist");
    expect(findings[0].severity).toBe("info");
    expect(findings[0].detectorId).toBe("hallucinated-package");
  });

  test("flags unknown package in devDependencies", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        devDependencies: {
          "another-fake-hallucinated-lib": "^2.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain("another-fake-hallucinated-lib");
  });

  test("does NOT flag known packages (react, express)", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        dependencies: {
          react: "^18.0.0",
          express: "^4.18.0",
          lodash: "^4.17.0",
          axios: "^1.0.0",
          zod: "^3.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("does NOT flag known scoped packages (@types/node, @babel/core)", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        devDependencies: {
          "@types/node": "^20.0.0",
          "@babel/core": "^7.0.0",
          "@testing-library/react": "^14.0.0",
          "@aws-sdk/client-s3": "^3.0.0",
          "@prisma/client": "^5.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("returns empty for non-package.json files", () => {
    const source = `import express from 'express';`;
    const ctx = makeCtx(source, "src/index.ts");
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("handles empty dependencies gracefully", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        dependencies: {},
        devDependencies: {},
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("handles missing dependencies keys gracefully", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        version: "1.0.0",
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("handles malformed JSON gracefully", () => {
    const source = "{ this is not valid json }}}";
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("reports correct line number for finding", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        dependencies: {
          react: "^18.0.0",
          "completely-hallucinated-package": "^1.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(1);

    // The finding line should be where "completely-hallucinated-package" appears
    const lines = source.split("\n");
    const expectedLine =
      lines.findIndex((l) => l.includes('"completely-hallucinated-package"')) + 1;
    expect(findings[0].line).toBe(expectedLine);
  });

  test("flags multiple unknown packages", () => {
    const source = JSON.stringify(
      {
        name: "my-app",
        dependencies: {
          react: "^18.0.0",
          "fake-dep-aaa": "^1.0.0",
          "fake-dep-bbb": "^2.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "fake-dev-dep-ccc": "^3.0.0",
        },
      },
      null,
      2,
    );
    const ctx = makeCtx(source);
    const findings = hallucinatedPackage.detect(ctx);
    expect(findings.length).toBe(3);
    const messages = findings.map((f) => f.message);
    expect(messages.some((m) => m.includes("fake-dep-aaa"))).toBe(true);
    expect(messages.some((m) => m.includes("fake-dep-bbb"))).toBe(true);
    expect(messages.some((m) => m.includes("fake-dev-dep-ccc"))).toBe(true);
  });
});
