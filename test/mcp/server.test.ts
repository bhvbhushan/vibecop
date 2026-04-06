import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  handleScan,
  handleCheck,
  handleExplain,
} from "../../src/mcp/server.js";
import { builtinDetectors } from "../../src/detectors/index.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures", "benchmark", "vibe-coded-1");
const FIXTURE_FILE = join(FIXTURES_DIR, "app.ts");

describe("vibecop_scan", () => {
  test("returns findings for a directory with issues", async () => {
    const result = await handleScan({ path: FIXTURES_DIR, maxFindings: 10 });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.findings).toBeInstanceOf(Array);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.filesScanned).toBeGreaterThan(0);

    // Each finding has expected shape
    const finding = parsed.findings[0];
    expect(finding).toHaveProperty("detectorId");
    expect(finding).toHaveProperty("message");
    expect(finding).toHaveProperty("severity");
    expect(finding).toHaveProperty("file");
    expect(finding).toHaveProperty("line");
  });

  test("respects maxFindings limit", async () => {
    const result = await handleScan({ path: FIXTURES_DIR, maxFindings: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.findings.length).toBeLessThanOrEqual(2);
  });

  test("returns error for invalid path", async () => {
    const result = await handleScan({ path: "/nonexistent/path/that/does/not/exist" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error scanning");
  });

  test("defaults to cwd when no path specified", async () => {
    // Should not throw - scans current working directory
    const result = await handleScan({});
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveProperty("findings");
    expect(parsed).toHaveProperty("filesScanned");
  });

  test("returns empty findings for a directory with no issues", async () => {
    // Scan an empty/clean fixtures directory
    const emptyDir = join(import.meta.dir, "..", "fixtures", "engine", "ignored");
    const result = await handleScan({ path: emptyDir, maxFindings: 50 });

    // Should not error
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.findings).toBeInstanceOf(Array);
    expect(parsed.findings.length).toBe(0);
  });
});

describe("vibecop_check", () => {
  test("returns findings for a file with issues", async () => {
    const result = await handleCheck({ file_path: FIXTURE_FILE });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.findings).toBeInstanceOf(Array);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.filesScanned).toBe(1);
  });

  test("respects maxFindings limit", async () => {
    const result = await handleCheck({ file_path: FIXTURE_FILE, maxFindings: 1 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.findings.length).toBeLessThanOrEqual(1);
  });

  test("returns error for non-existent file", async () => {
    const result = await handleCheck({ file_path: "/nonexistent/file.ts" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Error checking file");
    expect(result.content[0].text).toContain("File not found");
  });

  test("returns error for unsupported file type", async () => {
    // package.json is not a supported file type
    const result = await handleCheck({
      file_path: join(import.meta.dir, "..", "..", "package.json"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unsupported file type");
  });
});

describe("vibecop_explain", () => {
  test("returns metadata for a valid detector ID", async () => {
    const result = await handleExplain({ detector_id: "god-function" });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("god-function");
    expect(parsed).toHaveProperty("name");
    expect(parsed).toHaveProperty("description");
    expect(parsed).toHaveProperty("severity");
    expect(parsed).toHaveProperty("category");
    expect(parsed).toHaveProperty("languages");
    expect(parsed.languages).toBeInstanceOf(Array);
  });

  test("returns error with available IDs for unknown detector", async () => {
    const result = await handleExplain({ detector_id: "nonexistent-detector" });

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Unknown detector: "nonexistent-detector"');
    expect(text).toContain("Available detectors:");

    // Should list at least some real detector IDs
    expect(text).toContain("god-function");
    expect(text).toContain("unsafe-shell-exec");
  });

  test("returns correct metadata fields for unsafe-shell-exec", async () => {
    const result = await handleExplain({ detector_id: "unsafe-shell-exec" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("unsafe-shell-exec");
    expect(parsed.category).toBe("security");
    expect(parsed.severity).toBe("error");
    expect(parsed.languages).toContain("typescript");
  });

  test("lists all available detectors in error message", async () => {
    const result = await handleExplain({ detector_id: "no-such-id" });

    const text = result.content[0].text;
    // Every builtin detector ID should appear in the error message
    for (const detector of builtinDetectors) {
      expect(text).toContain(detector.id);
    }
  });
});
