import { describe, test, expect } from "bun:test";
import { parseDiff, findDiffPosition, isLineChanged } from "../../src/action/diff.js";

describe("parseDiff", () => {
  test("parses a simple single-file diff", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc123..def456 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,3 +1,4 @@",
      " const a = 1;",
      "+const b = 2;",
      " const c = 3;",
      " const d = 4;",
    ].join("\n");

    const fileDiffs = parseDiff(diff);
    const fd = fileDiffs.get("src/foo.ts");

    expect(fd).toBeDefined();
    expect(fd!.addedLines.has(2)).toBe(true);
    // @@ header occupies position 1 (not stored), content lines start at position 1
    // but wait — the hunk header increments position to 1, then the first content
    // line uses that value before incrementing again. So:
    //   @@ -> position becomes 1 (consumed by header)
    //   " const a" -> lineToPosition(1, 1), position becomes 2
    //   "+const b" -> lineToPosition(2, 2), position becomes 3
    //   " const c" -> lineToPosition(3, 3), position becomes 4
    //   " const d" -> lineToPosition(4, 4), position becomes 5
    // However, GitHub's diff position API is 1-indexed starting from the hunk header,
    // meaning the @@ header IS position 1 in GitHub's model. The code increments
    // position when it sees @@ (so position=1 is "used" by the header), then the
    // first content line gets position 1 because position was already incremented
    // before being assigned. Let me re-trace:
    //   position starts at 0
    //   @@ line: position++ -> position=1, continue
    //   " const a": set(1, 1), position++ -> position=2
    //   "+const b": set(2, 2), position++ -> position=3
    //   " const c": set(3, 3), position++ -> position=4
    //   " const d": set(4, 4), position++ -> position=5
    expect(fd!.lineToPosition.get(1)).toBe(1);
    expect(fd!.lineToPosition.get(2)).toBe(2);
    expect(fd!.lineToPosition.get(3)).toBe(3);
    expect(fd!.lineToPosition.get(4)).toBe(4);
  });

  test("parses a multi-file diff", () => {
    const diff = [
      "diff --git a/file1.ts b/file1.ts",
      "index abc..def 100644",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1,2 +1,3 @@",
      " line1",
      "+added",
      " line2",
      "diff --git a/file2.ts b/file2.ts",
      "index abc..def 100644",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1,2 +1,3 @@",
      " first",
      "+second",
      " third",
    ].join("\n");

    const fileDiffs = parseDiff(diff);

    expect(fileDiffs.has("file1.ts")).toBe(true);
    expect(fileDiffs.has("file2.ts")).toBe(true);

    const f1 = fileDiffs.get("file1.ts")!;
    expect(f1.addedLines.has(2)).toBe(true);
    expect(f1.lineToPosition.get(1)).toBe(1);
    expect(f1.lineToPosition.get(2)).toBe(2);
    expect(f1.lineToPosition.get(3)).toBe(3);

    const f2 = fileDiffs.get("file2.ts")!;
    expect(f2.addedLines.has(2)).toBe(true);
    // Position resets per file (new diff --git resets position to 0)
    expect(f2.lineToPosition.get(1)).toBe(1);
    expect(f2.lineToPosition.get(2)).toBe(2);
    expect(f2.lineToPosition.get(3)).toBe(3);
  });

  test("handles multiple hunks in one file", () => {
    const diff = [
      "diff --git a/big.ts b/big.ts",
      "index abc..def 100644",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added1",
      " line3",
      " line4",
      "@@ -10,3 +11,4 @@",
      " line10",
      "+added2",
      " line12",
      " line13",
    ].join("\n");

    const fileDiffs = parseDiff(diff);
    const fd = fileDiffs.get("big.ts")!;

    expect(fd).toBeDefined();
    expect(fd.addedLines.has(2)).toBe(true);
    expect(fd.addedLines.has(12)).toBe(true);

    // First hunk: @@ increments position to 1
    //   line1 -> pos 1, added1 -> pos 2, line3 -> pos 3, line4 -> pos 4
    // position is now 5
    // Second hunk: @@ increments position to 5 (no reset between hunks)
    //   line10 -> pos 5 (wait, @@ makes position 5, then line10 gets 5)
    // Let me re-trace:
    //   After first hunk, position = 5
    //   @@ line: position++ -> position = 6, continue
    //   Wait, position after line4 is 5 (it was 4 when set, then incremented to 5)
    //   @@ -> position++ -> 6, continue
    //   Wait, let me be more precise:
    //     pos=0 -> @@ -> pos=1 -> " line1" set(1,1), pos=2 -> "+added1" set(2,2), pos=3
    //     -> " line3" set(3,3), pos=4 -> " line4" set(4,4), pos=5
    //     -> @@ -> pos=6 -> " line10"(newLine=11) set(11,6), pos=7
    //     -> "+added2" set(12,7), pos=8 -> " line12"(newLine=13) set(13,8), pos=9
    //     -> " line13"(newLine=14) set(14,9), pos=10
    // Hmm, but the hunk header says +11,4 so newLineNumber starts at 11.
    expect(fd.lineToPosition.get(1)).toBe(1);
    expect(fd.lineToPosition.get(2)).toBe(2);
    expect(fd.lineToPosition.get(3)).toBe(3);
    expect(fd.lineToPosition.get(4)).toBe(4);

    // Position counter does NOT reset between hunks
    // Second @@ header takes position 5, first line of second hunk gets position 6
    expect(fd.lineToPosition.get(11)).toBe(6);
    expect(fd.lineToPosition.get(12)).toBe(7);
    expect(fd.lineToPosition.get(13)).toBe(8);
    expect(fd.lineToPosition.get(14)).toBe(9);

    // Verify positions are strictly increasing across hunks
    const pos4 = fd.lineToPosition.get(4)!;
    const pos11 = fd.lineToPosition.get(11)!;
    expect(pos11).toBeGreaterThan(pos4);
  });

  test("handles deletion-only lines", () => {
    const diff = [
      "diff --git a/del.ts b/del.ts",
      "index abc..def 100644",
      "--- a/del.ts",
      "+++ b/del.ts",
      "@@ -1,4 +1,3 @@",
      " keep1",
      "-removed",
      " keep2",
      " keep3",
    ].join("\n");

    const fileDiffs = parseDiff(diff);
    const fd = fileDiffs.get("del.ts")!;

    expect(fd).toBeDefined();
    expect(fd.addedLines.size).toBe(0);

    // @@ -> position=1
    // " keep1" (line 1) -> position=1, then position=2
    // "-removed" -> position=2, then position=3 (no line mapping, deletion only increments)
    // " keep2" (line 2) -> position=3, then position=4
    // " keep3" (line 3) -> position=4, then position=5
    expect(fd.lineToPosition.get(1)).toBe(1);
    expect(fd.lineToPosition.get(2)).toBe(3);
    expect(fd.lineToPosition.get(3)).toBe(4);
  });

  test("handles file renames", () => {
    const diff = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "index abc..def 100644",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "+added",
      " line3",
      " line4",
    ].join("\n");

    const fileDiffs = parseDiff(diff);

    expect(fileDiffs.has("new.ts")).toBe(true);
    expect(fileDiffs.has("old.ts")).toBe(false);

    const fd = fileDiffs.get("new.ts")!;
    expect(fd.addedLines.has(2)).toBe(true);
    expect(fd.lineToPosition.get(1)).toBe(1);
    expect(fd.lineToPosition.get(2)).toBe(2);
    expect(fd.lineToPosition.get(3)).toBe(3);
    expect(fd.lineToPosition.get(4)).toBe(4);
  });

  test("skips binary files", () => {
    const diff = [
      "diff --git a/image.png b/image.png",
      "Binary files differ",
      "diff --git a/code.ts b/code.ts",
      "index abc..def 100644",
      "--- a/code.ts",
      "+++ b/code.ts",
      "@@ -1,2 +1,3 @@",
      " line1",
      "+added",
      " line2",
    ].join("\n");

    const fileDiffs = parseDiff(diff);

    expect(fileDiffs.has("image.png")).toBe(false);
    expect(fileDiffs.has("code.ts")).toBe(true);

    const fd = fileDiffs.get("code.ts")!;
    expect(fd.addedLines.has(2)).toBe(true);
    expect(fd.lineToPosition.get(1)).toBe(1);
    expect(fd.lineToPosition.get(2)).toBe(2);
    expect(fd.lineToPosition.get(3)).toBe(3);
  });

  test("handles empty diff", () => {
    const fileDiffs = parseDiff("");
    expect(fileDiffs.size).toBe(0);
  });
});

describe("findDiffPosition", () => {
  const diff = [
    "diff --git a/src/foo.ts b/src/foo.ts",
    "index abc..def 100644",
    "--- a/src/foo.ts",
    "+++ b/src/foo.ts",
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "+const b = 2;",
    " const c = 3;",
    " const d = 4;",
  ].join("\n");
  const fileDiffs = parseDiff(diff);

  test("returns null for unknown file", () => {
    expect(findDiffPosition(fileDiffs, "unknown.ts", 1)).toBeNull();
  });

  test("returns null for line not in diff", () => {
    expect(findDiffPosition(fileDiffs, "src/foo.ts", 999)).toBeNull();
  });

  test("returns correct position for a known file and line", () => {
    expect(findDiffPosition(fileDiffs, "src/foo.ts", 2)).toBe(2);
  });
});

describe("isLineChanged", () => {
  const diff = [
    "diff --git a/src/foo.ts b/src/foo.ts",
    "index abc..def 100644",
    "--- a/src/foo.ts",
    "+++ b/src/foo.ts",
    "@@ -1,3 +1,4 @@",
    " const a = 1;",
    "+const b = 2;",
    " const c = 3;",
    " const d = 4;",
  ].join("\n");
  const fileDiffs = parseDiff(diff);

  test("returns true for added lines and false for context lines", () => {
    // Line 2 is added
    expect(isLineChanged(fileDiffs, "src/foo.ts", 2)).toBe(true);
    // Line 1 is a context line
    expect(isLineChanged(fileDiffs, "src/foo.ts", 1)).toBe(false);
    // Line 3 is a context line
    expect(isLineChanged(fileDiffs, "src/foo.ts", 3)).toBe(false);
    // Unknown file
    expect(isLineChanged(fileDiffs, "nope.ts", 1)).toBe(false);
  });
});
