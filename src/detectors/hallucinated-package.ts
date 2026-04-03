import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const knownPackages: string[] = JSON.parse(
  readFileSync(join(__dirname, "../data/known-packages.json"), "utf-8"),
);

const KNOWN_SET = new Set<string>(knownPackages);

/**
 * Common scoped-package prefixes from known organizations.
 * Any package under these scopes is considered real,
 * even if not individually listed in the allowlist.
 */
const KNOWN_SCOPES = new Set([
  "@types",
  "@babel",
  "@rollup",
  "@eslint",
  "@typescript-eslint",
  "@angular",
  "@vue",
  "@nuxt",
  "@svelte",
  "@sveltejs",
  "@react-native",
  "@react-native-community",
  "@aws-sdk",
  "@aws-cdk",
  "@google-cloud",
  "@azure",
  "@firebase",
  "@vercel",
  "@netlify",
  "@cloudflare",
  "@testing-library",
  "@storybook",
  "@prisma",
  "@trpc",
  "@tanstack",
  "@emotion",
  "@mui",
  "@chakra-ui",
  "@radix-ui",
  "@headlessui",
  "@sentry",
  "@datadog",
  "@opentelemetry",
  "@octokit",
  "@actions",
  "@nestjs",
  "@fastify",
  "@hapi",
  "@grpc",
  "@apollo",
  "@graphql-codegen",
  "@graphql-tools",
  "@remix-run",
  "@shopify",
  "@stripe",
  "@auth0",
  "@clerk",
  "@supabase",
  "@upstash",
  "@expo",
  "@react-navigation",
  "@mantine",
  "@floating-ui",
  "@dnd-kit",
  "@tailwindcss",
  "@heroicons",
  "@iconify",
  "@astrojs",
  "@sanity",
  "@contentful",
  "@mdx-js",
  "@codemirror",
  "@tiptap",
  "@monaco-editor",
  "@react-aria",
  "@react-stately",
  "@react-spring",
  "@react-three",
  "@fontsource",
  "@mapbox",
  "@nrwl",
  "@nx",
  "@swc",
  "@vitejs",
  "@esbuild",
  "@changesets",
  "@commitlint",
  "@semantic-release",
  "@rushstack",
  "@microsoft",
  "@sindresorhus",
  "@antfu",
  "@jridgewell",
  "@csstools",
  "@webassemblyjs",
  "@npmcli",
  "@isaacs",
  "@pkgr",
  "@nodelib",
  "@tsconfig",
  "@jest",
  "@vitest",
  "@sinonjs",
  "@hono",
  "@elysiajs",
  "@effect",
  "@langchain",
  "@ai-sdk",
  "@aws-lambda-powertools",
  "@middy",
  "@pulumi",
  "@builder.io",
  "@solidjs",
  "@biomejs",
]);

/**
 * Extract the scope from a scoped package name.
 * e.g. "@types/node" -> "@types"
 */
function getScope(packageName: string): string | null {
  if (!packageName.startsWith("@")) return null;
  const slashIdx = packageName.indexOf("/");
  if (slashIdx === -1) return null;
  return packageName.slice(0, slashIdx);
}

/**
 * Detects potentially hallucinated (non-existent) packages in package.json.
 *
 * Cross-references dependency names against a bundled allowlist of ~5000
 * known real npm packages. Packages not in the list and not under a known
 * scope are flagged as "potentially hallucinated" with severity: info.
 *
 * Background: USENIX Security 2025 found 19.7% of AI-suggested packages
 * are hallucinations — names that look plausible but don't exist on npm.
 */
export const hallucinatedPackage: Detector = {
  id: "hallucinated-package",
  meta: {
    name: "Hallucinated Package",
    description:
      "Detects potentially hallucinated (non-existent) packages in package.json",
    severity: "info",
    category: "correctness",
    languages: ["javascript", "typescript"],
    priority: 10,
  },
  detect(ctx: DetectionContext): Finding[] {
    // Only run on package.json files
    if (basename(ctx.file.path) !== "package.json") {
      return [];
    }

    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(ctx.source);
    } catch {
      return [];
    }

    const findings: Finding[] = [];
    const lines = ctx.source.split("\n");

    const deps = pkg.dependencies;
    const devDeps = pkg.devDependencies;

    const allDeps: string[] = [];
    if (deps && typeof deps === "object") {
      allDeps.push(...Object.keys(deps as Record<string, unknown>));
    }
    if (devDeps && typeof devDeps === "object") {
      allDeps.push(...Object.keys(devDeps as Record<string, unknown>));
    }

    for (const dep of allDeps) {
      // Skip if known
      if (KNOWN_SET.has(dep)) continue;

      // Skip if scope is known
      const scope = getScope(dep);
      if (scope && KNOWN_SCOPES.has(scope)) continue;

      // Find the line number where this package appears
      const searchStr = `"${dep}"`;
      let lineNum = 1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchStr)) {
          lineNum = i + 1;
          break;
        }
      }

      const col = (lines[lineNum - 1]?.indexOf(searchStr) ?? 0) + 1;

      findings.push(
        makeLineFinding(
          "hallucinated-package",
          ctx,
          lineNum,
          col,
          `Package '${dep}' is not in the known-packages allowlist — verify it exists on npm`,
          "info",
          `Run: npm view ${dep} to check if this package exists`,
        ),
      );
    }

    return findings;
  },
};
