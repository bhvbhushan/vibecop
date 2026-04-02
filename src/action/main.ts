import * as core from "@actions/core";
import * as github from "@actions/github";
import { resolve } from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../config.js";
import { builtinDetectors } from "../detectors/index.js";
import { pathsToFileInfos, runDetectors } from "../engine.js";
import { loadProjectInfo } from "../project.js";
import type { VibeCopConfig } from "../types.js";
import { parseDiff } from "./diff.js";
import { filterFindings } from "./filter.js";
import {
  applyLabel,
  closePr,
  createReview,
  formatInlineComment,
} from "./review.js";
import { buildActionSummary } from "./summary.js";

type OnFailure = "comment-only" | "request-changes" | "label" | "auto-close";
type SeverityThreshold = "error" | "warning" | "info";

const VALID_ON_FAILURE = new Set<OnFailure>([
  "comment-only",
  "request-changes",
  "label",
  "auto-close",
]);
const VALID_SEVERITY = new Set<SeverityThreshold>([
  "error",
  "warning",
  "info",
]);

async function run(): Promise<void> {
  // 1. Read inputs
  const token = core.getInput("github-token", { required: true });
  const configPath = core.getInput("config") || ".vibecop.yml";
  const onFailureInput = core.getInput("on-failure") || "comment-only";
  const severityInput = core.getInput("severity-threshold") || "warning";
  const labelInput = core.getInput("label") || "vibecop:needs-review";
  const maxFindingsInput = core.getInput("max-findings") || "50";
  const workingDirectory = core.getInput("working-directory") || ".";

  // 2. Validate context
  const { context } = github;
  if (!context.payload.pull_request) {
    core.setFailed(
      "vibecop action only runs on pull_request events. " +
        "Add 'on: pull_request' to your workflow.",
    );
    return;
  }

  const pullNumber = context.payload.pull_request.number;
  const { owner, repo } = context.repo;

  // 3. Load config
  let config: VibeCopConfig;
  try {
    config =
      configPath === ".vibecop.yml"
        ? loadConfig()
        : loadConfig(configPath);
  } catch {
    config = { ...DEFAULT_CONFIG };
    core.warning("Could not load .vibecop.yml config, using defaults");
  }

  // 4. Merge pr-gate config: action inputs take priority over config file
  const prGate = config["pr-gate"];
  const onFailure = (
    VALID_ON_FAILURE.has(onFailureInput as OnFailure)
      ? onFailureInput
      : prGate?.["on-failure"] ?? "comment-only"
  ) as OnFailure;

  const severityThreshold = (
    VALID_SEVERITY.has(severityInput as SeverityThreshold)
      ? severityInput
      : prGate?.["severity-threshold"] ?? "warning"
  ) as SeverityThreshold;

  const maxFindings = (() => {
    const parsed = Number.parseInt(maxFindingsInput, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    return prGate?.["max-findings"] ?? 50;
  })();

  const label = labelInput || prGate?.label || "vibecop:needs-review";

  // 5. Fetch PR diff
  const octokit = github.getOctokit(token);

  let diffText: string;
  try {
    const { data } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: "diff" },
    });
    // When requesting diff format, data is returned as a string
    diffText = data as unknown as string;
  } catch (error) {
    core.setFailed(
      `Failed to fetch PR diff: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const fileDiffs = parseDiff(diffText);
  const changedFiles = Array.from(fileDiffs.keys());

  // 6. Convert to FileInfo objects
  const scanRoot = resolve(workingDirectory);
  const files = pathsToFileInfos(changedFiles, scanRoot);

  if (files.length === 0) {
    core.info("No supported files changed in this PR");
    core.setOutput("findings-count", "0");
    core.setOutput("errors-count", "0");
    core.setOutput("warnings-count", "0");
    core.setOutput("has-findings", "false");
    core.setOutput("scan-time-ms", "0");
    return;
  }

  core.info(`Scanning ${files.length} changed files...`);

  // 7. Load project info and run detectors
  const project = loadProjectInfo(scanRoot);
  const startTime = performance.now();
  const result = runDetectors(files, builtinDetectors, project, config, {
    maxFindings,
  });
  const scanTimeMs = Math.round(performance.now() - startTime);

  core.info(
    `Scan complete: ${result.findings.length} findings in ${scanTimeMs}ms`,
  );

  // 8. Filter findings to inline vs summary-only
  const { inline, summaryOnly } = filterFindings(
    result.findings,
    fileDiffs,
    severityThreshold,
  );

  // 9. Build review comments and summary
  const reviewComments = inline.map((f) => ({
    path: f.file,
    position: f.diffPosition,
    body: formatInlineComment(f),
  }));

  const summaryBody = buildActionSummary(
    result,
    inline.length,
    summaryOnly,
    scanTimeMs,
  );

  // 10. Determine review event type
  const event =
    onFailure === "request-changes" && result.findings.length > 0
      ? ("REQUEST_CHANGES" as const)
      : ("COMMENT" as const);

  // 11. Post review (always post summary, even if no findings for visibility)
  try {
    await createReview(
      octokit,
      owner,
      repo,
      pullNumber,
      reviewComments,
      event,
      summaryBody,
    );
  } catch (error) {
    core.warning(
      `Failed to create PR review: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 12. Apply additional failure actions
  if (result.findings.length > 0) {
    if (onFailure === "label") {
      try {
        await applyLabel(octokit, owner, repo, pullNumber, label);
      } catch (error) {
        core.warning(
          `Failed to apply label: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (onFailure === "auto-close") {
      try {
        await closePr(octokit, owner, repo, pullNumber);
        core.warning(`PR #${pullNumber} auto-closed due to findings`);
      } catch (error) {
        core.warning(
          `Failed to auto-close PR: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // 13. Set outputs
  const errorCount = result.findings.filter(
    (f) => f.severity === "error",
  ).length;
  const warningCount = result.findings.filter(
    (f) => f.severity === "warning",
  ).length;

  core.setOutput("findings-count", String(result.findings.length));
  core.setOutput("errors-count", String(errorCount));
  core.setOutput("warnings-count", String(warningCount));
  core.setOutput("has-findings", String(result.findings.length > 0));
  core.setOutput("scan-time-ms", String(scanTimeMs));

  // 14. Write step summary
  await core.summary.addRaw(summaryBody).write();
}

run().catch((err) => {
  core.setFailed(
    err instanceof Error ? err.message : String(err),
  );
});
