import type { SgNode } from "@ast-grep/napi";
import type { DetectionContext, Finding, Severity } from "../types.js";

/**
 * Create a Finding from an AST node (ast-grep based detectors).
 * Extracts line/column/endLine/endColumn from the node's range,
 * converting from 0-indexed (ast-grep) to 1-indexed (Finding).
 */
export function makeFinding(
  detectorId: string,
  ctx: DetectionContext,
  node: SgNode,
  message: string,
  severity: Severity,
  suggestion?: string,
): Finding {
  const range = node.range();
  return {
    detectorId,
    message,
    severity,
    file: ctx.file.path,
    line: range.start.line + 1,
    column: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
    ...(suggestion != null && { suggestion }),
  };
}

/**
 * Create a Finding from explicit line/column values (regex/line-based detectors).
 * Line and column should already be 1-indexed.
 * Pass endLine/endColumn when range info is available.
 */
export function makeLineFinding(
  detectorId: string,
  ctx: DetectionContext,
  line: number,
  column: number,
  message: string,
  severity: Severity,
  suggestion?: string,
  endLine?: number,
  endColumn?: number,
): Finding {
  return {
    detectorId,
    message,
    severity,
    file: ctx.file.path,
    line,
    column,
    ...(suggestion != null && { suggestion }),
    ...(endLine != null && { endLine }),
    ...(endColumn != null && { endColumn }),
  };
}
