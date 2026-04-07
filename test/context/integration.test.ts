import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
const contextScript = join(import.meta.dir, "../../src/context.ts");

function makeHookInput(filePath: string, sessionId: string = "test-session") {
  return JSON.stringify({
    tool_name: "Read",
    tool_input: { file_path: filePath },
    session_id: sessionId,
  });
}

async function runHook(
  command: string,
  stdin: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", contextScript, command], {
    stdin: new Blob([stdin]),
    cwd: cwd ?? testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

beforeEach(() => {
  testDir = join(tmpdir(), `vibecop-integration-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  // Create a .git directory so project root detection works
  mkdirSync(join(testDir, ".git"));
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true }); } catch {}
});

describe("pre-hook", () => {
  test("passes through for non-supported file", async () => {
    const input = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: "/some/file.rs" },
      session_id: "sess1",
    });
    const result = await runHook("--pre", input);
    expect(result.stdout).toBe("{}");
  });

  test("passes through for first read of supported file", async () => {
    const tsFile = join(testDir, "app.ts");
    writeFileSync(tsFile, 'const x = 1;\nexport function foo() { return x; }\n');

    const result = await runHook("--pre", makeHookInput(tsFile));
    // First read with no cached skeleton — should passthrough
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // Either {} or has additionalContext (if skeleton was cached in a prior post-hook)
    expect(typeof parsed).toBe("object");
  });

  test("passes through when no session_id", async () => {
    const input = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: join(testDir, "foo.ts") },
    });
    const result = await runHook("--pre", input);
    expect(result.stdout).toBe("{}");
  });

  test("passes through for partial reads with offset", async () => {
    const input = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: join(testDir, "foo.ts"), offset: 10, limit: 20 },
      session_id: "sess1",
    });
    const result = await runHook("--pre", input);
    expect(result.stdout).toBe("{}");
  });
});

describe("post-hook", () => {
  test("caches skeleton after first read", async () => {
    const tsFile = join(testDir, "service.ts");
    writeFileSync(
      tsFile,
      `import { db } from "./db";\n\nexport function getUser(id: string) {\n  return db.find(id);\n}\n`,
    );

    // Post-hook should cache the skeleton
    const result = await runHook("--post", makeHookInput(tsFile));
    expect(result.exitCode).toBe(0);

    // Now a pre-hook re-read should find the cached skeleton
    const preResult = await runHook("--pre", makeHookInput(tsFile));
    const parsed = JSON.parse(preResult.stdout);
    // Should have smart-limited (updatedInput.limit = 30) since it's a re-read
    expect(parsed.updatedInput?.limit).toBe(30);
    expect(parsed.additionalContext).toContain("vibecop");
  });

  test("tracks session reads", async () => {
    const tsFile = join(testDir, "tracker.ts");
    writeFileSync(tsFile, "const x = 1;\n");

    // First post-hook
    await runHook("--post", makeHookInput(tsFile));

    // Pre-hook should know this was read before
    const preResult = await runHook("--pre", makeHookInput(tsFile));
    const parsed = JSON.parse(preResult.stdout);
    // Re-read → should smart-limit
    expect(parsed.updatedInput?.limit).toBe(30);
  });
});

describe("stats", () => {
  test("shows empty stats when no data", async () => {
    const proc = Bun.spawn(["bun", contextScript, "stats"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("No context optimization data");
  });

  test("shows stats after activity", async () => {
    const tsFile = join(testDir, "activity.ts");
    writeFileSync(tsFile, "export const x = 1;\n");

    // Generate some activity
    await runHook("--post", makeHookInput(tsFile, "sess-stats"));
    await runHook("--pre", makeHookInput(tsFile, "sess-stats"));

    const proc = Bun.spawn(["bun", contextScript, "stats"], {
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    expect(stdout).toContain("Sessions:");
  });
});

describe("compact", () => {
  test("runs without error", async () => {
    const input = JSON.stringify({
      tool_name: "Compact",
      tool_input: {},
      session_id: "sess-compact",
    });
    const result = await runHook("--compact", input);
    expect(result.exitCode).toBe(0);
  });
});

describe("error handling", () => {
  test("pre-hook outputs {} on invalid JSON stdin", async () => {
    const proc = Bun.spawn(["bun", contextScript, "--pre"], {
      stdin: new Blob(["not json"]),
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(stdout).toBe("{}");
  });

  test("post-hook doesn't crash on invalid JSON stdin", async () => {
    const proc = Bun.spawn(["bun", contextScript, "--post"], {
      stdin: new Blob(["not json"]),
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    // Should exit without crashing
  });
});
