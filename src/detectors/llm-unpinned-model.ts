import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeLineFinding } from "./utils.js";

/**
 * Detects unpinned LLM model aliases in string literals.
 * Flags model names that don't include a version date suffix like -20240806 or -YYYY-MM-DD.
 *
 * Examples of unpinned (flagged): "gpt-4o", "claude-3-5-sonnet-latest", "gemini-pro"
 * Examples of pinned (not flagged): "gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022"
 */

// Date suffix patterns that indicate a pinned model
const DATE_SUFFIX_RE = /[-_]\d{8}$/; // -20240806
const DATE_DASH_SUFFIX_RE = /[-_]\d{4}-\d{2}-\d{2}$/; // -2024-08-06

// Known unpinned model aliases to detect (exact matches or patterns)
const UNPINNED_MODEL_PATTERNS: RegExp[] = [
  // OpenAI models
  /^gpt-4o$/,
  /^gpt-4$/,
  /^gpt-4o-mini$/,
  /^gpt-4-turbo$/,
  /^gpt-3\.5-turbo$/,
  /^o1$/,
  /^o1-mini$/,
  /^o1-preview$/,
  /^o3$/,
  /^o3-mini$/,
  /^o4-mini$/,
  // Anthropic models with "-latest" suffix
  /^claude-.*-latest$/,
  // Anthropic bare model names (no date, no "latest")
  /^claude-3-opus$/,
  /^claude-3-haiku$/,
  /^claude-3-5-sonnet$/,
  /^claude-3-5-haiku$/,
  /^claude-sonnet-4$/,
  /^claude-opus-4$/,
  // Google models
  /^gemini-pro$/,
  /^gemini-1\.5-pro$/,
  /^gemini-1\.5-flash$/,
  /^gemini-2\.0-flash$/,
];

function isPinned(model: string): boolean {
  return DATE_SUFFIX_RE.test(model) || DATE_DASH_SUFFIX_RE.test(model);
}

function isUnpinnedModel(value: string): boolean {
  if (isPinned(value)) return false;
  return UNPINNED_MODEL_PATTERNS.some((re) => re.test(value));
}

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const lines = ctx.source.split("\n");

  // Regex to extract string literals — both single and double quoted
  const stringLiteralRe = /(['"])([^'"]*)\1/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    stringLiteralRe.lastIndex = 0;

    while ((match = stringLiteralRe.exec(line)) !== null) {
      const value = match[2];
      if (isUnpinnedModel(value)) {
        findings.push(
          makeLineFinding(
            "llm-unpinned-model",
            ctx,
            i + 1, // 1-indexed
            match.index + 1, // 1-indexed
            `Unpinned model alias "${value}" — model behavior may change without notice`,
            "warning",
            `Pin to a specific version with a date suffix, e.g. "${value}-YYYYMMDD"`,
          ),
        );
      }
    }
  }

  return findings;
}

export const llmUnpinnedModel: Detector = {
  id: "llm-unpinned-model",
  meta: {
    name: "LLM Unpinned Model",
    description:
      "Detects unpinned LLM model aliases that may change behavior without notice",
    severity: "warning",
    category: "quality",
    languages: ["javascript", "typescript", "tsx", "python"],
    priority: 10,
  },
  detect,
};
