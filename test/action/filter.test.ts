import { describe, test, expect } from "bun:test";
import { filterFindings } from "../../src/action/filter.js";
import type { FileDiff } from "../../src/action/diff.js";
import type { Finding } from "../../src/types.js";

function makeFinding(overrides: Partial<Finding> & { file: string; line: number }): Finding {
  return {
    detectorId: "test-rule",
    message: "test message",
    severity: "warning",
    column: 1,
    ...overrides,
  };
}

function makeFileDiff(
  filename: string,
  addedLines: number[],
  positions: [number, number][],
): FileDiff {
  return {
    filename,
    addedLines: new Set(addedLines),
    lineToPosition: new Map(positions),
  };
}

describe("filterFindings", () => {
  test("puts findings on added lines into inline", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [5], [[5, 3]]));

    const findings: Finding[] = [makeFinding({ file: "src/a.ts", line: 5 })];
    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(1);
    expect(result.inline[0].diffPosition).toBe(3);
    expect(result.summaryOnly).toHaveLength(0);
  });

  test("puts findings on unchanged lines into summaryOnly", () => {
    const fileDiffs = new Map<string, FileDiff>();
    // Line 3 is in lineToPosition but NOT in addedLines (it's a context line)
    fileDiffs.set(
      "src/a.ts",
      makeFileDiff("src/a.ts", [5], [
        [3, 2],
        [5, 4],
      ]),
    );

    const findings: Finding[] = [makeFinding({ file: "src/a.ts", line: 3 })];
    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(0);
    expect(result.summaryOnly).toHaveLength(1);
    expect(result.summaryOnly[0].line).toBe(3);
  });

  test("puts findings for files not in diff into summaryOnly", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [5], [[5, 3]]));

    const findings: Finding[] = [makeFinding({ file: "src/other.ts", line: 10 })];
    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(0);
    expect(result.summaryOnly).toHaveLength(1);
    expect(result.summaryOnly[0].file).toBe("src/other.ts");
  });

  test("filters by severity threshold", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [1, 2], [
      [1, 2],
      [2, 3],
    ]));

    const findings: Finding[] = [
      makeFinding({ file: "src/a.ts", line: 1, severity: "warning" }),
      makeFinding({ file: "src/a.ts", line: 2, severity: "info" }),
    ];
    const result = filterFindings(findings, fileDiffs, "warning");

    // Info finding should be excluded entirely
    expect(result.inline).toHaveLength(1);
    expect(result.inline[0].severity).toBe("warning");
    expect(result.summaryOnly).toHaveLength(0);
  });

  test("severity threshold error excludes warnings", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [1, 2, 3], [
      [1, 2],
      [2, 3],
      [3, 4],
    ]));

    const findings: Finding[] = [
      makeFinding({ file: "src/a.ts", line: 1, severity: "error" }),
      makeFinding({ file: "src/a.ts", line: 2, severity: "warning" }),
      makeFinding({ file: "src/a.ts", line: 3, severity: "info" }),
    ];
    const result = filterFindings(findings, fileDiffs, "error");

    expect(result.inline).toHaveLength(1);
    expect(result.inline[0].severity).toBe("error");
    expect(result.summaryOnly).toHaveLength(0);
  });

  test("severity threshold info includes all", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [1, 2, 3], [
      [1, 2],
      [2, 3],
      [3, 4],
    ]));

    const findings: Finding[] = [
      makeFinding({ file: "src/a.ts", line: 1, severity: "error" }),
      makeFinding({ file: "src/a.ts", line: 2, severity: "warning" }),
      makeFinding({ file: "src/a.ts", line: 3, severity: "info" }),
    ];
    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(3);
    expect(result.summaryOnly).toHaveLength(0);
  });

  test("caps inline at 50 and overflows to summaryOnly", () => {
    const fileDiffs = new Map<string, FileDiff>();
    const addedLines: number[] = [];
    const positions: [number, number][] = [];
    for (let i = 1; i <= 60; i++) {
      addedLines.push(i);
      positions.push([i, i + 1]);
    }
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", addedLines, positions));

    const findings: Finding[] = [];
    for (let i = 1; i <= 60; i++) {
      findings.push(makeFinding({ file: "src/a.ts", line: i }));
    }

    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(50);
    expect(result.summaryOnly).toHaveLength(10);
  });

  test("sorts inline by file then line", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/b.ts", makeFileDiff("src/b.ts", [10, 5], [
      [10, 3],
      [5, 2],
    ]));
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [3, 1], [
      [3, 4],
      [1, 2],
    ]));

    const findings: Finding[] = [
      makeFinding({ file: "src/b.ts", line: 10 }),
      makeFinding({ file: "src/a.ts", line: 3 }),
      makeFinding({ file: "src/b.ts", line: 5 }),
      makeFinding({ file: "src/a.ts", line: 1 }),
    ];

    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(4);
    expect(result.inline[0].file).toBe("src/a.ts");
    expect(result.inline[0].line).toBe(1);
    expect(result.inline[1].file).toBe("src/a.ts");
    expect(result.inline[1].line).toBe(3);
    expect(result.inline[2].file).toBe("src/b.ts");
    expect(result.inline[2].line).toBe(5);
    expect(result.inline[3].file).toBe("src/b.ts");
    expect(result.inline[3].line).toBe(10);
  });

  test("handles empty findings array", () => {
    const fileDiffs = new Map<string, FileDiff>();
    fileDiffs.set("src/a.ts", makeFileDiff("src/a.ts", [1], [[1, 2]]));

    const result = filterFindings([], fileDiffs, "info");

    expect(result.inline).toHaveLength(0);
    expect(result.summaryOnly).toHaveLength(0);
  });

  test("handles empty fileDiffs", () => {
    const fileDiffs = new Map<string, FileDiff>();

    const findings: Finding[] = [
      makeFinding({ file: "src/a.ts", line: 1 }),
      makeFinding({ file: "src/b.ts", line: 5 }),
    ];
    const result = filterFindings(findings, fileDiffs, "info");

    expect(result.inline).toHaveLength(0);
    expect(result.summaryOnly).toHaveLength(2);
  });
});
