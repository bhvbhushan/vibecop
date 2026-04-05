import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { VibeCopConfig, PrGateConfig, RuleConfig } from "./types.js";

const RuleConfigSchema = z
  .object({
    severity: z.enum(["error", "warning", "info", "off"]).optional(),
  })
  .catchall(z.unknown());

const PrGateConfigSchema = z.object({
  "on-failure": z
    .enum(["comment-only", "request-changes", "label", "auto-close"])
    .default("comment-only"),
  label: z.string().default("vibecop:needs-review"),
  "severity-threshold": z
    .enum(["error", "warning", "info"])
    .default("warning"),
  "max-findings": z.number().int().min(0).default(50),
});

const VibeCopConfigSchema = z.object({
  rules: z.record(z.string(), RuleConfigSchema).default({}),
  ignore: z
    .array(z.string())
    .default(["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/docs/**", "**/vendor/**", "**/*.min.js", "**/*.d.ts"]),
  "pr-gate": PrGateConfigSchema.optional(),
  "custom-rules-dir": z.string().optional(),
});

export const DEFAULT_CONFIG: VibeCopConfig = {
  rules: {},
  ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/docs/**", "**/vendor/**", "**/*.min.js", "**/*.d.ts"],
};

/**
 * Load and validate an vibecop config file.
 *
 * If `configPath` is provided, reads that file directly.
 * Otherwise searches for `.vibecop.yml` in the current working directory.
 *
 * Returns defaults when no config file is found.
 * Throws on invalid YAML or validation errors.
 */
export function loadConfig(configPath?: string): VibeCopConfig {
  const filePath = configPath ?? resolve(process.cwd(), ".vibecop.yml");

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err)) {
      if (err.code === "ENOENT") {
        return { ...DEFAULT_CONFIG };
      }
      if (err.code === "EACCES") {
        throw new Error(
          `Permission denied reading config file: ${filePath}`,
        );
      }
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (cause: unknown) {
    throw new Error(
      `Invalid YAML in config file ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  // Handle empty YAML files (parsed as null/undefined)
  if (parsed == null) {
    return { ...DEFAULT_CONFIG };
  }

  const result = VibeCopConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid config in ${filePath}:\n${issues}`,
    );
  }

  return mergeWithDefaults(result.data);
}

/**
 * Merge a parsed config with defaults.
 * User-specified ignore patterns replace defaults entirely.
 * User-specified rules are merged on top of the empty default.
 */
function mergeWithDefaults(
  userConfig: z.infer<typeof VibeCopConfigSchema>,
): VibeCopConfig {
  const config: VibeCopConfig = {
    rules: userConfig.rules as Record<string, RuleConfig>,
    ignore: userConfig.ignore,
  };
  if (userConfig["pr-gate"]) {
    config["pr-gate"] = userConfig["pr-gate"] as PrGateConfig;
  }
  return config;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
