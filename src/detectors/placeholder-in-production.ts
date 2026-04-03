import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

const PLACEHOLDER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /["'].*yourdomain\.com.*["']/, description: "placeholder domain" },
  { pattern: /["'].*example\.com.*["']/, description: "example domain" },
  { pattern: /["']changeme["']/i, description: "placeholder password" },
  { pattern: /["']CHANGEME["']/, description: "placeholder value" },
  { pattern: /["']your[_-]?(?:api[_-]?key|secret|token|password)["']/i, description: "placeholder credential" },
  { pattern: /["']xxx+["']/i, description: "placeholder value" },
  { pattern: /["']TODO[_: ].*["']/i, description: "TODO placeholder" },
  { pattern: /["']REPLACE[_-]?(?:ME|THIS)["']/i, description: "placeholder value" },
  { pattern: /["']sk[_-](?:test|live)[_-]xxxx+["']/i, description: "placeholder API key" },
  { pattern: /["']pk[_-](?:test|live)[_-]xxxx+["']/i, description: "placeholder API key" },
];

// Only flag in files that look like config/setup, not in error messages or docs
const CONFIG_CONTEXTS = /(?:domain|host|url|endpoint|origin|cookie|cors|config|env|setting|secret|key|token|password|credential)/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const lines = ctx.source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) continue;

    // Skip HTML placeholder attributes (e.g., placeholder="https://example.com")
    if (/placeholder\s*[:=]/i.test(line)) continue;

    for (const { pattern, description } of PLACEHOLDER_PATTERNS) {
      const match = line.match(pattern);
      if (!match) continue;

      // For generic patterns, require config-like context on the same line or nearby
      const hasContext = CONFIG_CONTEXTS.test(line);
      if (!hasContext && description === "placeholder value") continue;

      findings.push(makeLineFinding(
        "placeholder-in-production",
        ctx,
        i + 1,
        (match.index ?? 0) + 1,
        `Placeholder ${description} found: ${match[0].slice(0, 40)}`,
        "error",
        "Replace with actual configuration value or use environment variable",
      ));
      break; // Only one finding per line
    }
  }

  return findings;
}

export const placeholderInProduction: Detector = {
  id: "placeholder-in-production",
  meta: {
    name: "Placeholder in Production",
    description: "Detects placeholder values (yourdomain.com, changeme, xxx) left in production configuration",
    severity: "error",
    category: "security",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
