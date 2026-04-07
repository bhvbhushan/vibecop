import { describe, expect, test } from "bun:test";
import { extractSkeleton, languageForExtension } from "../../src/context/skeleton.js";

describe("languageForExtension", () => {
  test("maps .ts to typescript", () => {
    expect(languageForExtension(".ts")).toBe("typescript");
  });

  test("maps .py to python", () => {
    expect(languageForExtension(".py")).toBe("python");
  });

  test("returns null for unknown extension", () => {
    expect(languageForExtension(".rs")).toBeNull();
  });
});

describe("extractSkeleton", () => {
  describe("TypeScript", () => {
    test("extracts imports", () => {
      const source = `import { useState } from "react";\nimport path from "node:path";\n\nconst x = 1;`;
      const skeleton = extractSkeleton(source, "typescript");
      expect(skeleton).toContain("react");
      expect(skeleton).toContain("node:path");
    });

    test("extracts function signatures", () => {
      const source = `
function greet(name: string): string {
  return "hello " + name;
}

const add = (a: number, b: number) => {
  return a + b;
};
`;
      const skeleton = extractSkeleton(source, "typescript");
      expect(skeleton).toContain("greet");
    });

    test("extracts class with methods", () => {
      const source = `
class UserService {
  constructor(private db: Database) {}
  getUser(id: string) { return this.db.find(id); }
  deleteUser(id: string) { this.db.delete(id); }
}
`;
      const skeleton = extractSkeleton(source, "typescript");
      expect(skeleton).toContain("UserService");
      expect(skeleton).toContain("constructor");
      expect(skeleton).toContain("getUser");
      expect(skeleton).toContain("deleteUser");
    });

    test("extracts exports", () => {
      const source = `export const VERSION = "1.0";\nexport type Config = { verbose: boolean };`;
      const skeleton = extractSkeleton(source, "typescript");
      expect(skeleton).toContain("VERSION");
      expect(skeleton).toContain("Config");
    });

    test("is much shorter than original", () => {
      const source = `
import { readFileSync } from "node:fs";

function processFile(path: string): string {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\\n");
  const filtered = lines.filter(l => l.trim().length > 0);
  const numbered = filtered.map((l, i) => \`\${i + 1}: \${l}\`);
  const result = numbered.join("\\n");
  console.log(\`Processed \${filtered.length} lines\`);
  return result;
}

export function main() {
  const result = processFile("./input.txt");
  console.log(result);
}
`;
      const skeleton = extractSkeleton(source, "typescript");
      expect(skeleton.length).toBeLessThan(source.length * 0.6);
    });
  });

  describe("JavaScript", () => {
    test("extracts require-style code", () => {
      const source = `
const fs = require("fs");

function readConfig(path) {
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

module.exports = { readConfig };
`;
      const skeleton = extractSkeleton(source, "javascript");
      expect(skeleton).toContain("readConfig");
    });
  });

  describe("Python", () => {
    test("extracts imports and functions", () => {
      const source = `import os\nfrom pathlib import Path\n\ndef process(path: str) -> str:\n    with open(path) as f:\n        return f.read()\n`;
      const skeleton = extractSkeleton(source, "python");
      expect(skeleton).toContain("import os");
      expect(skeleton).toContain("pathlib");
      expect(skeleton).toContain("process");
    });

    test("extracts class with methods", () => {
      const source = `class Dog:\n    def __init__(self, name):\n        self.name = name\n    def bark(self):\n        print("woof")\n`;
      const skeleton = extractSkeleton(source, "python");
      expect(skeleton).toContain("Dog");
      expect(skeleton).toContain("__init__");
      expect(skeleton).toContain("bark");
    });
  });

  describe("edge cases", () => {
    test("handles empty source", () => {
      const skeleton = extractSkeleton("", "typescript");
      expect(typeof skeleton).toBe("string");
    });

    test("handles source with only comments", () => {
      const skeleton = extractSkeleton("// just a comment\n/* block */", "typescript");
      expect(typeof skeleton).toBe("string");
    });
  });
});
