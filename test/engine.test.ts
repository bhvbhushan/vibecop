import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { dedupFindings, discoverFiles, runDetectors } from "../src/engine.js";
import type {
  VibeCopConfig,
  Detector,
  DetectionContext,
  Finding,
  ProjectInfo,
} from "../src/types.js";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "engine");

const EMPTY_CONFIG: VibeCopConfig = { rules: {}, ignore: [] };

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

/** A detector that returns a single hardcoded finding for each file it processes */
function makeFindingDetector(id: string): Detector {
  return {
    id,
    meta: {
      name: id,
      description: "Test detector that returns one finding per file",
      severity: "warning",
      category: "quality",
      languages: ["typescript", "javascript", "python"],
    },
    detect(ctx: DetectionContext): Finding[] {
      return [
        {
          detectorId: id,
          message: `Finding from ${id}`,
          severity: "warning",
          file: ctx.file.path,
          line: 1,
          column: 1,
        },
      ];
    },
  };
}

/** A detector that always throws */
function makeThrowingDetector(id: string): Detector {
  return {
    id,
    meta: {
      name: id,
      description: "Test detector that throws unconditionally",
      severity: "error",
      category: "quality",
      languages: ["typescript", "javascript", "python"],
    },
    detect(_ctx: DetectionContext): Finding[] {
      throw new Error(`Detector ${id} threw deliberately`);
    },
  };
}

/** A detector that returns no findings */
function makeNoOpDetector(id: string): Detector {
  return {
    id,
    meta: {
      name: id,
      description: "Test detector that returns no findings",
      severity: "info",
      category: "quality",
      languages: ["typescript", "javascript", "python"],
    },
    detect(_ctx: DetectionContext): Finding[] {
      return [];
    },
  };
}

describe("discoverFiles", () => {
  test("finds .ts and .py files in the fixture directory", () => {
    const files = discoverFiles(FIXTURES_DIR, EMPTY_CONFIG);

    const extensions = files.map((f) => f.extension);
    expect(extensions).toContain(".ts");
    expect(extensions).toContain(".py");
  });

  test("assigns correct language for .ts files", () => {
    const files = discoverFiles(FIXTURES_DIR, EMPTY_CONFIG);

    const tsFiles = files.filter((f) => f.extension === ".ts");
    expect(tsFiles.length).toBeGreaterThan(0);
    for (const f of tsFiles) {
      expect(f.language).toBe("typescript");
    }
  });

  test("assigns correct language for .py files", () => {
    const files = discoverFiles(FIXTURES_DIR, EMPTY_CONFIG);

    const pyFiles = files.filter((f) => f.extension === ".py");
    expect(pyFiles.length).toBeGreaterThan(0);
    for (const f of pyFiles) {
      expect(f.language).toBe("python");
    }
  });

  test("respects ignore patterns", () => {
    const config: VibeCopConfig = {
      rules: {},
      ignore: ["ignored/**"],
    };
    const files = discoverFiles(FIXTURES_DIR, config);

    const ignoredFiles = files.filter((f) => f.path.includes("ignored"));
    expect(ignoredFiles.length).toBe(0);
  });

  test("skips binary files", () => {
    // All fixture files are text — this verifies none are misclassified as binary
    const files = discoverFiles(FIXTURES_DIR, EMPTY_CONFIG);
    expect(files.length).toBeGreaterThan(0);
    // If binary detection were broken, it would filter out valid text files.
    // We verify the known text fixtures are present.
    const names = files.map((f) => f.path);
    expect(names.some((n) => n.includes("sample.ts"))).toBe(true);
  });

  test("each file has absolutePath set", () => {
    const files = discoverFiles(FIXTURES_DIR, EMPTY_CONFIG);
    for (const f of files) {
      expect(f.absolutePath).toStartWith("/");
    }
  });
});

describe("runDetectors", () => {
  test("collects findings from detectors", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");
    expect(tsFiles.length).toBeGreaterThan(0);

    const detector = makeFindingDetector("test-finding");
    const result = runDetectors(tsFiles, [detector], EMPTY_PROJECT, EMPTY_CONFIG);

    expect(result.findings.length).toBe(tsFiles.length);
    expect(result.findings[0].detectorId).toBe("test-finding");
  });

  test("returns zero findings when no detectors match language", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");

    const pythonOnlyDetector: Detector = {
      id: "python-only",
      meta: {
        name: "python-only",
        description: "Only runs on Python",
        severity: "info",
        category: "quality",
        languages: ["python"],
      },
      detect(_ctx: DetectionContext): Finding[] {
        return [
          {
            detectorId: "python-only",
            message: "Python finding",
            severity: "info",
            file: _ctx.file.path,
            line: 1,
            column: 1,
          },
        ];
      },
    };

    const result = runDetectors(tsFiles, [pythonOnlyDetector], EMPTY_PROJECT, EMPTY_CONFIG);
    expect(result.findings.length).toBe(0);
  });

  test("detector isolation: a throwing detector does not crash the scan", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");
    expect(tsFiles.length).toBeGreaterThan(0);

    const throwingDetector = makeThrowingDetector("throwing-detector");
    const goodDetector = makeFindingDetector("good-detector");

    const result = runDetectors(
      tsFiles,
      [throwingDetector, goodDetector],
      EMPTY_PROJECT,
      EMPTY_CONFIG,
    );

    // The throwing detector should produce errors, not crash
    expect(result.errors.length).toBeGreaterThan(0);
    const throwErrors = result.errors.filter(
      (e) => e.detectorId === "throwing-detector",
    );
    expect(throwErrors.length).toBeGreaterThan(0);
    expect(throwErrors[0].message).toContain("threw deliberately");

    // The good detector should still produce findings
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].detectorId).toBe("good-detector");
  });

  test("filesScanned reflects actual files processed when no cap", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");

    const result = runDetectors(tsFiles, [makeNoOpDetector("noop")], EMPTY_PROJECT, EMPTY_CONFIG);

    expect(result.filesScanned).toBe(tsFiles.length);
  });

  test("maxFindings: scan stops collecting after cap is reached", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");
    // Need at least 2 TS files to test early exit properly
    expect(tsFiles.length).toBeGreaterThanOrEqual(2);

    const cap = 1;
    const result = runDetectors(
      tsFiles,
      [makeFindingDetector("capped-detector")],
      EMPTY_PROJECT,
      EMPTY_CONFIG,
      { maxFindings: cap },
    );

    expect(result.findings.length).toBe(cap);
    // filesScanned should reflect how many files were actually processed
    // before hitting the cap — not the full list
    expect(result.filesScanned).toBeLessThan(tsFiles.length);
    expect(result.filesScanned).toBeGreaterThan(0);
  });

  test("disabled detector rule is skipped", () => {
    const files = discoverFiles(FIXTURES_DIR, {
      rules: {},
      ignore: ["ignored/**"],
    });
    const tsFiles = files.filter((f) => f.language === "typescript");

    const config: VibeCopConfig = {
      rules: {
        "disabled-detector": { severity: "off" },
      },
      ignore: [],
    };

    const detector = makeFindingDetector("disabled-detector");
    const result = runDetectors(tsFiles, [detector], EMPTY_PROJECT, config);

    expect(result.findings.length).toBe(0);
  });
});

describe("dedupFindings", () => {
  test("keeps higher-priority finding when two detectors flag same line", () => {
    const findings: Finding[] = [
      {
        detectorId: "low-priority",
        message: "Low priority finding",
        severity: "info",
        file: "src/app.ts",
        line: 10,
        column: 1,
      },
      {
        detectorId: "high-priority",
        message: "High priority finding",
        severity: "error",
        file: "src/app.ts",
        line: 10,
        column: 5,
      },
    ];

    const detectors: Detector[] = [
      {
        id: "low-priority",
        meta: {
          name: "Low",
          description: "Low priority detector",
          severity: "info",
          category: "quality",
          languages: ["typescript"],
          priority: 1,
        },
        detect: () => [],
      },
      {
        id: "high-priority",
        meta: {
          name: "High",
          description: "High priority detector",
          severity: "error",
          category: "security",
          languages: ["typescript"],
          priority: 10,
        },
        detect: () => [],
      },
    ];

    const result = dedupFindings(findings, detectors);
    expect(result.length).toBe(1);
    expect(result[0].detectorId).toBe("high-priority");
  });

  test("keeps both findings when they are on different lines", () => {
    const findings: Finding[] = [
      {
        detectorId: "detector-a",
        message: "Finding A",
        severity: "warning",
        file: "src/app.ts",
        line: 10,
        column: 1,
      },
      {
        detectorId: "detector-b",
        message: "Finding B",
        severity: "warning",
        file: "src/app.ts",
        line: 20,
        column: 1,
      },
    ];

    const detectors: Detector[] = [
      {
        id: "detector-a",
        meta: {
          name: "A",
          description: "Detector A",
          severity: "warning",
          category: "quality",
          languages: ["typescript"],
          priority: 5,
        },
        detect: () => [],
      },
      {
        id: "detector-b",
        meta: {
          name: "B",
          description: "Detector B",
          severity: "warning",
          category: "quality",
          languages: ["typescript"],
          priority: 5,
        },
        detect: () => [],
      },
    ];

    const result = dedupFindings(findings, detectors);
    expect(result.length).toBe(2);
  });

  test("keeps the only finding when there is no overlap", () => {
    const findings: Finding[] = [
      {
        detectorId: "solo-detector",
        message: "Solo finding",
        severity: "error",
        file: "src/app.ts",
        line: 5,
        column: 1,
      },
    ];

    const detectors: Detector[] = [
      {
        id: "solo-detector",
        meta: {
          name: "Solo",
          description: "Solo detector",
          severity: "error",
          category: "security",
          languages: ["typescript"],
          priority: 10,
        },
        detect: () => [],
      },
    ];

    const result = dedupFindings(findings, detectors);
    expect(result.length).toBe(1);
    expect(result[0].detectorId).toBe("solo-detector");
  });

  test("treats undefined priority as 0", () => {
    const findings: Finding[] = [
      {
        detectorId: "no-priority",
        message: "No priority",
        severity: "info",
        file: "src/app.ts",
        line: 10,
        column: 1,
      },
      {
        detectorId: "has-priority",
        message: "Has priority",
        severity: "warning",
        file: "src/app.ts",
        line: 10,
        column: 5,
      },
    ];

    const detectors: Detector[] = [
      {
        id: "no-priority",
        meta: {
          name: "NoPriority",
          description: "No priority set",
          severity: "info",
          category: "quality",
          languages: ["typescript"],
          // priority intentionally omitted — should default to 0
        },
        detect: () => [],
      },
      {
        id: "has-priority",
        meta: {
          name: "HasPriority",
          description: "Priority is 5",
          severity: "warning",
          category: "quality",
          languages: ["typescript"],
          priority: 5,
        },
        detect: () => [],
      },
    ];

    const result = dedupFindings(findings, detectors);
    expect(result.length).toBe(1);
    expect(result[0].detectorId).toBe("has-priority");
  });
});
