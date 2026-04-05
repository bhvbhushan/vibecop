import type { Detector, DetectionContext, Finding } from "../types.js";
import { isTestFile, makeLineFinding } from "./utils.js";

const SNAPSHOT_RE = /\.toMatchSnapshot\(|\.toMatchInlineSnapshot\(/g;
const EXPECT_RE = /\bexpect\s*\(/g;

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  const source = ctx.source;

  // Count snapshot assertions
  const snapshotCount = (source.match(SNAPSHOT_RE) ?? []).length;
  if (snapshotCount === 0) return [];

  // Count total expect() calls
  const totalExpects = (source.match(EXPECT_RE) ?? []).length;
  if (totalExpects === 0) return [];

  // Non-snapshot = total expect calls minus snapshot calls
  const nonSnapshotCount = totalExpects - snapshotCount;

  if (nonSnapshotCount === 0) {
    return [
      makeLineFinding(
        "snapshot-only-test",
        ctx,
        1,
        1,
        `All ${snapshotCount} assertions in this file are snapshots. Snapshots verify serialization, not behavior.`,
        "info",
        "Add behavioral assertions (toBe, toEqual, toHaveBeenCalled) alongside snapshots.",
      ),
    ];
  }

  return [];
}

export const snapshotOnlyTest: Detector = {
  id: "snapshot-only-test",
  meta: {
    name: "Snapshot-Only Test",
    description:
      "Detects test files where all assertions are snapshot assertions",
    severity: "info",
    category: "testing",
    languages: ["javascript", "typescript", "tsx"],
  },
  detect,
};
