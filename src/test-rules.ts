import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, Lang as SgLang } from "@ast-grep/napi";
import YAML from "yaml";
import { CustomRuleSchema, type CustomRule } from "./custom-rules.js";
import type { Lang } from "./types.js";

const LANG_MAP: Record<Lang, SgLang> = {
  javascript: SgLang.JavaScript,
  typescript: SgLang.TypeScript,
  tsx: SgLang.Tsx,
  python: SgLang.JavaScript, // fallback; custom rules for Python need dynamic registration
};

interface TestResult {
  ruleId: string;
  passed: boolean;
  details: string[];
}

function testRule(rule: CustomRule): TestResult {
  const details: string[] = [];
  let passed = true;

  if (!rule.examples) {
    return {
      ruleId: rule.id,
      passed: true,
      details: ["no examples defined, skipping"],
    };
  }

  // Pick the first supported language for testing
  const lang = rule.languages[0] as Lang;
  const sgLang = LANG_MAP[lang] ?? SgLang.JavaScript;

  // Test invalid examples (should match)
  if (rule.examples.invalid) {
    for (let i = 0; i < rule.examples.invalid.length; i++) {
      const code = rule.examples.invalid[i];
      const root = parse(sgLang, code);
      const matches = root.root().findAll({
        rule: rule.rule as Record<string, unknown>,
      });
      if (matches.length === 0) {
        details.push(`invalid example ${i + 1} did not match (rule may be wrong)`);
        passed = false;
      }
    }
  }

  // Test valid examples (should NOT match)
  if (rule.examples.valid) {
    for (let i = 0; i < rule.examples.valid.length; i++) {
      const code = rule.examples.valid[i];
      const root = parse(sgLang, code);
      const matches = root.root().findAll({
        rule: rule.rule as Record<string, unknown>,
      });
      if (matches.length > 0) {
        details.push(`valid example ${i + 1} matched unexpectedly`);
        passed = false;
      }
    }
  }

  if (passed) {
    const invalidCount = rule.examples.invalid?.length ?? 0;
    const validCount = rule.examples.valid?.length ?? 0;
    details.push(
      `${invalidCount} invalid example${invalidCount !== 1 ? "s" : ""} matched, ${validCount} valid example${validCount !== 1 ? "s" : ""} clean`,
    );
  }

  return { ruleId: rule.id, passed, details };
}

export function runTestRules(rulesDir: string): {
  results: TestResult[];
  passed: number;
  failed: number;
} {
  if (!existsSync(rulesDir)) {
    console.error(`Error: Rules directory not found: ${rulesDir}`);
    return { results: [], passed: 0, failed: 0 };
  }

  const entries = readdirSync(rulesDir).filter(
    (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
  );

  if (entries.length === 0) {
    console.log("No rule files found.");
    return { results: [], passed: 0, failed: 0 };
  }

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const entry of entries) {
    const filePath = join(rulesDir, entry);
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      console.error(`Could not read ${filePath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch {
      console.error(`Invalid YAML in ${filePath}`);
      continue;
    }

    const validation = CustomRuleSchema.safeParse(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      console.error(`Invalid rule in ${filePath}: ${issues}`);
      failed++;
      results.push({
        ruleId: entry,
        passed: false,
        details: [`validation failed: ${issues}`],
      });
      continue;
    }

    const result = testRule(validation.data);
    results.push(result);
    if (result.passed) {
      passed++;
    } else {
      failed++;
    }
  }

  // Output results
  for (const r of results) {
    const icon = r.passed ? "\u2713" : "\u2717";
    const details = r.details.join("; ");
    console.log(`${icon} ${r.ruleId}: ${details}`);
  }

  console.log(`\n${passed} rule${passed !== 1 ? "s" : ""} passed, ${failed} rule${failed !== 1 ? "s" : ""} failed`);

  return { results, passed, failed };
}
