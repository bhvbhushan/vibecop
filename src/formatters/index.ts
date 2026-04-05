import type { ScanResult } from "../types.js";
import { formatAgent } from "./agent.js";
import { formatGcc } from "./gcc.js";
import { formatGithub } from "./github.js";
import { formatHtml } from "./html.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";
import { formatText } from "./text.js";
import type { TextFormatOptions } from "./text.js";

export { formatAgent } from "./agent.js";
export { formatGcc } from "./gcc.js";
export { formatGithub } from "./github.js";
export { formatHtml } from "./html.js";
export { formatJson } from "./json.js";
export { formatSarif } from "./sarif.js";
export { formatText } from "./text.js";
export type { TextFormatOptions } from "./text.js";

/** Supported format names */
export type FormatName = "text" | "json" | "github" | "sarif" | "html" | "agent" | "gcc";

export interface FormatOptions {
  groupBy?: "file" | "rule";
}

/**
 * Get a formatter function by name.
 * Throws for unrecognized formats.
 */
export function getFormatter(
  format: string,
  options?: FormatOptions,
): (result: ScanResult) => string {
  switch (format) {
    case "text":
      return (result) => formatText(result, options);
    case "json":
      return formatJson;
    case "github":
      return formatGithub;
    case "sarif":
      return formatSarif;
    case "html":
      return formatHtml;
    case "agent":
      return formatAgent;
    case "gcc":
      return formatGcc;
    default:
      throw new Error(
        `Unknown format '${format}'. Available formats: text, json, github, sarif, html, agent, gcc`,
      );
  }
}
