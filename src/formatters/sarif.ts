import type { Finding, ScanResult } from "../types.js";

/** SARIF severity levels */
type SarifLevel = "error" | "warning" | "note" | "none";

/** Map finding severity to SARIF level */
function sarifLevel(severity: Finding["severity"]): SarifLevel {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "note";
  }
}

/** Derive a human-readable rule name from a detector ID */
function ruleNameFromId(id: string): string {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Derive a SARIF tag from the detector ID */
function ruleTag(id: string): string {
  // Use "quality" as a reasonable default tag — in a real system this would
  // come from detector metadata, but we don't have that in the Finding type.
  return "quality";
}

/**
 * Build the set of unique SARIF rule descriptors from findings.
 * Returns rules in the order they were first encountered.
 */
function buildRules(
  findings: Finding[],
): Array<{
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
  properties: { tags: string[] };
}> {
  const seen = new Map<
    string,
    {
      id: string;
      shortDescription: { text: string };
      defaultConfiguration: { level: SarifLevel };
      properties: { tags: string[] };
    }
  >();

  for (const f of findings) {
    if (!seen.has(f.detectorId)) {
      seen.set(f.detectorId, {
        id: f.detectorId,
        shortDescription: { text: ruleNameFromId(f.detectorId) },
        defaultConfiguration: { level: sarifLevel(f.severity) },
        properties: { tags: [ruleTag(f.detectorId)] },
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * Format scan results as SARIF 2.1.0 JSON.
 *
 * Produces a complete, valid SARIF log with:
 * - Tool driver metadata with rules derived from findings
 * - Results array with physical locations
 * - Invocations with execution status and error notifications
 */
export function formatSarif(result: ScanResult): string {
  const rules = buildRules(result.findings);
  const ruleIndex = new Map<string, number>();
  for (let i = 0; i < rules.length; i++) {
    ruleIndex.set(rules[i].id, i);
  }

  const results = result.findings.map((f) => ({
    ruleId: f.detectorId,
    ruleIndex: ruleIndex.get(f.detectorId) ?? 0,
    level: sarifLevel(f.severity),
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.file },
          region: {
            startLine: f.line,
            startColumn: f.column,
            endLine: f.endLine ?? f.line,
            endColumn: f.endColumn ?? f.column,
          },
        },
      },
    ],
  }));

  const toolExecutionNotifications = result.errors.map((err) => ({
    message: { text: err.message },
    level: "error" as const,
    descriptor: err.detectorId ? { id: err.detectorId } : undefined,
    associatedRule: err.detectorId ? { id: err.detectorId } : undefined,
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: err.file },
        },
      },
    ],
  }));

  const sarif = {
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0" as const,
    runs: [
      {
        tool: {
          driver: {
            name: "vibecop",
            version: "0.1.0",
            informationUri: "https://github.com/bhvbhushan/vibecop",
            rules,
          },
        },
        results,
        invocations: [
          {
            executionSuccessful: result.errors.length === 0,
            toolExecutionNotifications,
          },
        ],
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
