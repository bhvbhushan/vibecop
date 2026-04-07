/**
 * Context optimization benchmark. Zero bun:sqlite dependency.
 * Works under both node and bun. Can be imported by MCP server and CLI directly.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { extractSkeleton, languageForExtension } from "./skeleton.js";
import { estimateTokens, isSupportedExtension } from "./session.js";

export interface FileMetrics {
  path: string;
  fullTokens: number;
  skeletonTokens: number;
  reductionPercent: number;
}

export interface BenchmarkResult {
  files: FileMetrics[];
  totalFiles: number;
  totalTokens: number;
  projections: Array<{
    rereadPercent: number;
    tokensSaved: number;
    percentOfTotal: number;
  }>;
}

function walkSupported(dir: string, root: string, results: FileMetrics[]): void {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSupported(fullPath, root, results);
    } else if (entry.isFile() && isSupportedExtension(fullPath)) {
      try {
        const stat = statSync(fullPath);
        if (stat.size > 500_000 || stat.size === 0) continue;

        const source = readFileSync(fullPath, "utf-8");
        const lang = languageForExtension(extname(fullPath));
        if (!lang) continue;

        const fullTokens = estimateTokens(source);
        const skeleton = extractSkeleton(source, lang);
        const skeletonTokens = estimateTokens(skeleton);
        const reductionPercent = fullTokens > 0
          ? Math.round((1 - (skeletonTokens + 128) / fullTokens) * 100)
          : 0;

        results.push({
          path: relative(root, fullPath),
          fullTokens,
          skeletonTokens,
          reductionPercent: Math.max(0, reductionPercent),
        });
      } catch {}
    }
  }
}

/** Run benchmark on a project. Returns structured data (no console output). */
export function benchmark(projectRoot: string): BenchmarkResult {
  const root = resolve(projectRoot);
  const files: FileMetrics[] = [];
  walkSupported(root, root, files);

  const totalTokens = files.reduce((sum, f) => sum + f.fullTokens, 0);
  const sorted = [...files].sort((a, b) => b.fullTokens - a.fullTokens);

  const projections = [20, 40, 60].map((rereadPercent) => {
    const rereadCount = Math.round(files.length * rereadPercent / 100);
    const rereadFiles = sorted.slice(0, rereadCount);
    const tokensSaved = rereadFiles.reduce((sum, f) => {
      const limited = 128 + f.skeletonTokens;
      return sum + Math.max(0, f.fullTokens - limited);
    }, 0);
    return {
      rereadPercent,
      tokensSaved,
      percentOfTotal: totalTokens > 0 ? Math.round(tokensSaved / totalTokens * 100) : 0,
    };
  });

  return { files: sorted, totalFiles: files.length, totalTokens, projections };
}

/** Format benchmark result as human-readable text. */
export function formatBenchmark(result: BenchmarkResult): string {
  if (result.totalFiles === 0) {
    return "No supported files found (.js, .ts, .tsx, .py).";
  }

  const lines: string[] = [];
  lines.push("vibecop context benchmark");
  lines.push("═════════════════════════");
  lines.push("");
  lines.push(`Files:        ${result.totalFiles} supported`);
  lines.push(`Total tokens: ~${result.totalTokens.toLocaleString()}`);
  lines.push("");

  const top = result.files.slice(0, 10);
  lines.push("Largest files (most savings potential):");
  const maxPath = Math.max(...top.map(f => f.path.length), 10);
  for (const f of top) {
    const pathPad = f.path.padEnd(maxPath);
    lines.push(`  ${pathPad}  ${f.fullTokens.toLocaleString().padStart(6)} tokens → skeleton: ${f.skeletonTokens.toLocaleString().padStart(5)} (${f.reductionPercent}% reduction)`);
  }
  lines.push("");

  lines.push("Projected savings per session:");
  for (const p of result.projections) {
    lines.push(`  ${p.rereadPercent}% re-read rate:  ~${p.tokensSaved.toLocaleString()} tokens saved (${p.percentOfTotal}% of total Read usage)`);
  }

  lines.push("");
  lines.push("To enable: vibecop init --context");

  return lines.join("\n");
}
