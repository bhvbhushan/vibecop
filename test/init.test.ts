import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "../src/init.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "vibecop-init-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("vibecop init", () => {
  test("detects Claude Code when .claude/ directory exists", async () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });

    await runInit(tempDir);

    expect(existsSync(join(tempDir, ".claude", "settings.json"))).toBe(true);
    const settings = JSON.parse(
      readFileSync(join(tempDir, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse[0].matcher).toBe("Edit|Write|MultiEdit");
  });

  test("detects Cursor when .cursor/ directory exists", async () => {
    mkdirSync(join(tempDir, ".cursor"), { recursive: true });

    await runInit(tempDir);

    expect(existsSync(join(tempDir, ".cursor", "hooks.json"))).toBe(true);
    const hooks = JSON.parse(
      readFileSync(join(tempDir, ".cursor", "hooks.json"), "utf-8"),
    );
    expect(hooks.hooks.afterFileEdit).toBeDefined();
    expect(hooks.hooks.afterFileEdit[0].command).toContain("vibecop scan");

    expect(existsSync(join(tempDir, ".cursor", "rules", "vibecop.md"))).toBe(
      true,
    );
    const rules = readFileSync(
      join(tempDir, ".cursor", "rules", "vibecop.md"),
      "utf-8",
    );
    expect(rules).toContain("trigger: always_on");
  });

  test("generates correct config files for detected tools", async () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    mkdirSync(join(tempDir, ".cursor"), { recursive: true });
    mkdirSync(join(tempDir, ".github"), { recursive: true });

    await runInit(tempDir);

    // Claude Code
    expect(existsSync(join(tempDir, ".claude", "settings.json"))).toBe(true);

    // Cursor
    expect(existsSync(join(tempDir, ".cursor", "hooks.json"))).toBe(true);
    expect(existsSync(join(tempDir, ".cursor", "rules", "vibecop.md"))).toBe(
      true,
    );

    // GitHub Copilot
    expect(
      existsSync(join(tempDir, ".github", "copilot-instructions.md")),
    ).toBe(true);
    const copilot = readFileSync(
      join(tempDir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(copilot).toContain("vibecop");
  });

  test("handles no tools detected gracefully", async () => {
    // tempDir has no tool directories — should not throw
    await runInit(tempDir);

    // No config files should be generated
    expect(existsSync(join(tempDir, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(tempDir, ".cursor", "hooks.json"))).toBe(false);
  });

  test("does not overwrite existing .claude/settings.json", async () => {
    mkdirSync(join(tempDir, ".claude"), { recursive: true });
    const existingContent = JSON.stringify({ custom: true }, null, 2);
    writeFileSync(join(tempDir, ".claude", "settings.json"), existingContent);

    await runInit(tempDir);

    const content = readFileSync(
      join(tempDir, ".claude", "settings.json"),
      "utf-8",
    );
    expect(content).toBe(existingContent);
  });

  test("appends to existing .github/copilot-instructions.md without duplication", async () => {
    mkdirSync(join(tempDir, ".github"), { recursive: true });
    const existingContent = "# Copilot Instructions\n\nBe helpful.\n";
    writeFileSync(
      join(tempDir, ".github", "copilot-instructions.md"),
      existingContent,
    );

    await runInit(tempDir);

    const content = readFileSync(
      join(tempDir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    expect(content).toContain("# Copilot Instructions");
    expect(content).toContain("vibecop");

    // Run again — should not duplicate
    await runInit(tempDir);

    const contentAfterSecondRun = readFileSync(
      join(tempDir, ".github", "copilot-instructions.md"),
      "utf-8",
    );
    const vibecopOccurrences = contentAfterSecondRun.split("## vibecop").length - 1;
    expect(vibecopOccurrences).toBe(1);
  });

  test("generates Cline config when .clinerules exists", async () => {
    writeFileSync(join(tempDir, ".clinerules"), "existing rules\n");

    await runInit(tempDir);

    const content = readFileSync(join(tempDir, ".clinerules"), "utf-8");
    expect(content).toContain("vibecop scan");
  });

  test("generates Cline config when .cline/ directory exists", async () => {
    mkdirSync(join(tempDir, ".cline"), { recursive: true });

    await runInit(tempDir);

    expect(existsSync(join(tempDir, ".clinerules"))).toBe(true);
    const content = readFileSync(join(tempDir, ".clinerules"), "utf-8");
    expect(content).toContain("vibecop scan");
  });

  test("generates Windsurf config when .windsurf/ exists", async () => {
    mkdirSync(join(tempDir, ".windsurf"), { recursive: true });

    await runInit(tempDir);

    expect(
      existsSync(join(tempDir, ".windsurf", "rules", "vibecop.md")),
    ).toBe(true);
    const content = readFileSync(
      join(tempDir, ".windsurf", "rules", "vibecop.md"),
      "utf-8",
    );
    expect(content).toContain("trigger: always_on");
  });

  test("generates Codex CLI config when .codex/ exists", async () => {
    mkdirSync(join(tempDir, ".codex"), { recursive: true });

    await runInit(tempDir);

    expect(existsSync(join(tempDir, ".codex", "hooks.json"))).toBe(true);
    const hooks = JSON.parse(
      readFileSync(join(tempDir, ".codex", "hooks.json"), "utf-8"),
    );
    expect(hooks.hooks.PostToolUse).toBeDefined();
  });
});
