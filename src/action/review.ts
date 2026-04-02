import type { GitHub } from "@actions/github/lib/utils";
import type { Finding } from "../types.js";

export interface ReviewComment {
  path: string;
  position: number;
  body: string;
}

/** Map severity to emoji for inline comment display */
function severityEmoji(severity: Finding["severity"]): string {
  switch (severity) {
    case "error":
      return ":x:";
    case "warning":
      return ":warning:";
    case "info":
      return ":information_source:";
  }
}

/**
 * Create a PR review with optional inline comments.
 *
 * Posts a review on the given pull request. If the comments array is empty,
 * the review is created with just the body text.
 */
export async function createReview(
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string,
  pullNumber: number,
  comments: ReviewComment[],
  event: "COMMENT" | "REQUEST_CHANGES",
  body: string,
): Promise<void> {
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      body,
      event,
      comments:
        comments.length > 0
          ? comments.map((c) => ({
              path: c.path,
              position: c.position,
              body: c.body,
            }))
          : undefined,
    });
  } catch (error) {
    throw new Error(
      `Failed to create review on ${owner}/${repo}#${pullNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Apply a label to a pull request.
 *
 * Uses the issues API since PRs are issues in the GitHub API.
 */
export async function applyLabel(
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string,
  pullNumber: number,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pullNumber,
      labels: [label],
    });
  } catch (error) {
    throw new Error(
      `Failed to apply label "${label}" to ${owner}/${repo}#${pullNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Close a pull request by setting its state to "closed".
 */
export async function closePr(
  octokit: InstanceType<typeof GitHub>,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<void> {
  try {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      state: "closed",
    });
  } catch (error) {
    throw new Error(
      `Failed to close PR ${owner}/${repo}#${pullNumber}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Format a finding into a review comment body string.
 *
 * Produces a markdown block with the detector ID, severity emoji,
 * finding message, and an optional suggestion quote.
 */
export function formatInlineComment(
  finding: Finding & { suggestion?: string },
): string {
  const lines: string[] = [];

  lines.push(`**vibecop** | \`${finding.detectorId}\` | ${severityEmoji(finding.severity)}`);
  lines.push("");
  lines.push(finding.message);

  if (finding.suggestion) {
    lines.push("");
    lines.push(`> **Suggestion:** ${finding.suggestion}`);
  }

  return lines.join("\n");
}
