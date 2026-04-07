import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** Compute SHA-256 hash of file content. */
export function hashFile(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/** Compute SHA-256 hash of a string. */
export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Estimate token count from string length (rough ~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Check if a file extension is supported for context optimization. */
const SUPPORTED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"]);

export function isSupportedExtension(filePath: string): boolean {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return SUPPORTED_EXTENSIONS.has(filePath.slice(lastDot));
}

/** Check if file exists and is not too large for skeleton extraction. */
const MAX_FILE_SIZE = 500_000; // 500KB

export function isFileEligible(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    return stat.isFile() && stat.size <= MAX_FILE_SIZE;
  } catch {
    return false;
  }
}
