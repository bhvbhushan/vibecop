import { describe, expect, test } from "bun:test";
import {
  formatInlineComment,
  createReview,
  applyLabel,
  closePr,
} from "../../src/action/review.js";
import type { Finding } from "../../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    detectorId: "test-rule",
    message: "test message",
    severity: "warning",
    file: "test.ts",
    line: 1,
    column: 1,
    ...overrides,
  };
}

function createMockOctokit() {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    octokit: {
      rest: {
        pulls: {
          createReview: async (params: unknown) => {
            calls.push({ method: "pulls.createReview", params });
          },
          update: async (params: unknown) => {
            calls.push({ method: "pulls.update", params });
          },
        },
        issues: {
          addLabels: async (params: unknown) => {
            calls.push({ method: "issues.addLabels", params });
          },
        },
      },
    } as any, // Cast to avoid typing the full Octokit
  };
}

describe("formatInlineComment", () => {
  test("formats basic finding without suggestion", () => {
    const finding = makeFinding({
      detectorId: "empty-catch",
      severity: "error",
      message: "Empty catch block found",
    });

    const output = formatInlineComment(finding);

    expect(output).toContain("**vibecop**");
    expect(output).toContain("`empty-catch`");
    expect(output).toContain(":x:");
    expect(output).toContain("Empty catch block found");
    expect(output).not.toContain("Suggestion");
  });

  test("formats finding with suggestion", () => {
    const finding = {
      ...makeFinding({
        detectorId: "no-any",
        severity: "warning",
        message: "Avoid using any",
      }),
      suggestion: "Use unknown instead",
    };

    const output = formatInlineComment(finding);

    expect(output).toContain("> **Suggestion:** Use unknown instead");
  });

  test("uses correct emoji for each severity", () => {
    const errorOutput = formatInlineComment(makeFinding({ severity: "error" }));
    expect(errorOutput).toContain(":x:");

    const warningOutput = formatInlineComment(makeFinding({ severity: "warning" }));
    expect(warningOutput).toContain(":warning:");

    const infoOutput = formatInlineComment(makeFinding({ severity: "info" }));
    expect(infoOutput).toContain(":information_source:");
  });
});

describe("createReview", () => {
  test("posts review with comments", async () => {
    const { calls, octokit } = createMockOctokit();
    const comments = [
      { path: "src/a.ts", position: 5, body: "Issue here" },
      { path: "src/b.ts", position: 10, body: "Another issue" },
    ];

    await createReview(
      octokit,
      "test-owner",
      "test-repo",
      42,
      comments,
      "REQUEST_CHANGES",
      "Review body",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("pulls.createReview");

    const params = calls[0].params as Record<string, unknown>;
    expect(params.owner).toBe("test-owner");
    expect(params.repo).toBe("test-repo");
    expect(params.pull_number).toBe(42);
    expect(params.event).toBe("REQUEST_CHANGES");
    expect(params.body).toBe("Review body");
    expect(params.comments).toHaveLength(2);
  });

  test("posts review without comments when array is empty", async () => {
    const { calls, octokit } = createMockOctokit();

    await createReview(
      octokit,
      "test-owner",
      "test-repo",
      7,
      [],
      "COMMENT",
      "All good",
    );

    expect(calls).toHaveLength(1);
    const params = calls[0].params as Record<string, unknown>;
    expect(params.comments).toBeUndefined();
  });

  test("wraps API errors with context", async () => {
    const octokit = {
      rest: {
        pulls: {
          createReview: async () => {
            throw new Error("API rate limit exceeded");
          },
        },
      },
    } as any;

    await expect(
      createReview(octokit, "owner", "repo", 1, [], "COMMENT", "body"),
    ).rejects.toThrow("Failed to create review on owner/repo#1");
  });
});

describe("applyLabel", () => {
  test("adds label to pull request", async () => {
    const { calls, octokit } = createMockOctokit();

    await applyLabel(octokit, "test-owner", "test-repo", 99, "vibecop:failing");

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("issues.addLabels");

    const params = calls[0].params as Record<string, unknown>;
    expect(params.owner).toBe("test-owner");
    expect(params.repo).toBe("test-repo");
    expect(params.issue_number).toBe(99);
    expect(params.labels).toEqual(["vibecop:failing"]);
  });
});

describe("closePr", () => {
  test("updates PR state to closed", async () => {
    const { calls, octokit } = createMockOctokit();

    await closePr(octokit, "test-owner", "test-repo", 15);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("pulls.update");

    const params = calls[0].params as Record<string, unknown>;
    expect(params.owner).toBe("test-owner");
    expect(params.repo).toBe("test-repo");
    expect(params.pull_number).toBe(15);
    expect(params.state).toBe("closed");
  });
});
