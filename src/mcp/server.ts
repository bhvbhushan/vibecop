import { z } from "zod";
import { scan, checkFile } from "../engine.js";
import { builtinDetectors } from "../detectors/index.js";
import type { ScanResult } from "../types.js";

/** Format a ScanResult as a JSON text content block for MCP */
function formatScanResult(result: ScanResult) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            findings: result.findings,
            filesScanned: result.filesScanned,
            errors: result.errors,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/** Input schema for vibecop_scan */
export const scanInputSchema = {
  path: z.string().optional().describe("Directory to scan. Defaults to current working directory."),
  maxFindings: z.number().optional().describe("Maximum findings to return. Default 50."),
};

/** Handler for vibecop_scan tool */
export async function handleScan(args: {
  path?: string;
  maxFindings?: number;
}) {
  try {
    const result = await scan({
      scanPath: args.path,
      maxFindings: args.maxFindings ?? 50,
    });
    return formatScanResult(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error scanning: ${message}` }],
      isError: true,
    };
  }
}

/** Input schema for vibecop_check */
export const checkInputSchema = {
  file_path: z.string().describe("Absolute or relative path to the file to check."),
  maxFindings: z.number().optional().describe("Maximum findings to return. Default 50."),
};

/** Handler for vibecop_check tool */
export async function handleCheck(args: {
  file_path: string;
  maxFindings?: number;
}) {
  try {
    const result = checkFile(args.file_path, {
      maxFindings: args.maxFindings ?? 50,
    });
    return formatScanResult(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error checking file: ${message}` }],
      isError: true,
    };
  }
}

/** Input schema for vibecop_explain */
export const explainInputSchema = {
  detector_id: z.string().describe('The detector ID (e.g., "unsafe-shell-exec", "god-function").'),
};

/** Handler for vibecop_explain tool */
export async function handleExplain(args: { detector_id: string }) {
  const detector = builtinDetectors.find((d) => d.id === args.detector_id);

  if (!detector) {
    const availableIds = builtinDetectors.map((d) => d.id).sort();
    return {
      content: [
        {
          type: "text" as const,
          text: `Unknown detector: "${args.detector_id}". Available detectors:\n${availableIds.map((id) => `  - ${id}`).join("\n")}`,
        },
      ],
      isError: true,
    };
  }

  const { meta } = detector;
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            id: detector.id,
            name: meta.name,
            description: meta.description,
            severity: meta.severity,
            category: meta.category,
            languages: meta.languages,
          },
          null,
          2,
        ),
      },
    ],
  };
}
