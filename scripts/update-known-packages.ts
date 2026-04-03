#!/usr/bin/env bun
/**
 * Fetches top npm packages by download count and writes to src/data/known-packages.json
 *
 * Usage: bun run scripts/update-known-packages.ts
 * Run monthly via CI to keep the list fresh.
 *
 * Uses the npm registry search API, paginating to collect ~5000 popular packages.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "../src/data/known-packages.json");

const TARGET_COUNT = 5000;
const PAGE_SIZE = 250; // npm search API max per page
const BASE_URL = "https://registry.npmjs.org/-/v1/search";

interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string;
    };
  }>;
  total: number;
}

async function fetchPage(from: number): Promise<string[]> {
  const url = `${BASE_URL}?text=boost-exact:false&size=${PAGE_SIZE}&from=${from}&quality=0.0&maintenance=0.0&popularity=1.0`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`npm search failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as NpmSearchResult;
  return data.objects.map((o) => o.package.name);
}

async function main() {
  const allPackages = new Set<string>();
  let from = 0;

  console.log(`Fetching top ${TARGET_COUNT} npm packages...`);

  while (allPackages.size < TARGET_COUNT) {
    try {
      const names = await fetchPage(from);
      if (names.length === 0) break;

      for (const name of names) {
        allPackages.add(name);
      }

      console.log(`  Fetched ${allPackages.size} packages (from=${from})`);
      from += PAGE_SIZE;

      // Small delay to be respectful to the API
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`Error fetching page at from=${from}:`, err);
      break;
    }
  }

  const sorted = [...allPackages].sort((a, b) => a.localeCompare(b));

  writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`\nWrote ${sorted.length} packages to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
