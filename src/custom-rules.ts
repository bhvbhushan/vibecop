import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { Detector, DetectionContext, Finding, Lang } from "./types.js";
import { makeFinding } from "./detectors/utils.js";

export const CustomRuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  description: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  category: z.enum(["correctness", "quality", "security", "testing"]),
  languages: z.array(
    z.enum(["javascript", "typescript", "tsx", "python"]),
  ),
  message: z.string(),
  suggestion: z.string().optional(),
  rule: z.record(z.unknown()),
  examples: z
    .object({
      valid: z.array(z.string()).optional(),
      invalid: z.array(z.string()).optional(),
    })
    .optional(),
});

export type CustomRule = z.infer<typeof CustomRuleSchema>;

function ruleToDetector(rule: CustomRule): Detector {
  return {
    id: rule.id,
    meta: {
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      category: rule.category,
      languages: rule.languages as Lang[],
    },
    detect(ctx: DetectionContext): Finding[] {
      if (!rule.languages.includes(ctx.file.language)) return [];
      const root = ctx.root.root();
      const matches = root.findAll({
        rule: rule.rule as Record<string, unknown>,
      });
      return matches.map((node) =>
        makeFinding(
          rule.id,
          ctx,
          node,
          rule.message,
          rule.severity,
          rule.suggestion,
        ),
      );
    },
  };
}

/**
 * Load custom YAML rules from a directory.
 * Returns an array of Detector objects, one per valid rule file.
 * Logs warnings for invalid files but does not throw.
 */
export function loadCustomRules(rulesDir: string): Detector[] {
  if (!existsSync(rulesDir)) return [];

  const detectors: Detector[] = [];
  let entries: string[];
  try {
    entries = readdirSync(rulesDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;

    const filePath = join(rulesDir, entry);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (err: unknown) {
      console.warn(
        `Warning: Could not read custom rule ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err: unknown) {
      console.warn(
        `Warning: Invalid YAML in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const result = CustomRuleSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      console.warn(`Warning: Invalid custom rule in ${filePath}: ${issues}`);
      continue;
    }

    detectors.push(ruleToDetector(result.data));
  }

  return detectors;
}
