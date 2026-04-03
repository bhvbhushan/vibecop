import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface DetectedTool {
  name: string;
  detected: boolean;
  reason: string;
}

interface GeneratedFile {
  path: string;
  description: string;
}

const SCAN_CMD = "npx vibecop scan --diff HEAD --format agent";

function detectTools(cwd: string): DetectedTool[] {
  const tools: DetectedTool[] = [];

  tools.push({
    name: "Claude Code",
    detected: existsSync(join(cwd, ".claude")),
    reason: existsSync(join(cwd, ".claude"))
      ? ".claude/ directory found"
      : "not found",
  });

  tools.push({
    name: "Cursor",
    detected: existsSync(join(cwd, ".cursor")),
    reason: existsSync(join(cwd, ".cursor"))
      ? ".cursor/ directory found"
      : "not found",
  });

  tools.push({
    name: "Codex CLI",
    detected: existsSync(join(cwd, ".codex")),
    reason: existsSync(join(cwd, ".codex"))
      ? ".codex/ directory found"
      : "not found",
  });

  let aiderInstalled = false;
  try {
    execSync("which aider", { stdio: "pipe" });
    aiderInstalled = true;
  } catch {
    aiderInstalled = false;
  }
  tools.push({
    name: "Aider",
    detected: aiderInstalled,
    reason: aiderInstalled ? "aider installed" : "not found",
  });

  tools.push({
    name: "Windsurf",
    detected: existsSync(join(cwd, ".windsurf")),
    reason: existsSync(join(cwd, ".windsurf"))
      ? ".windsurf/ directory found"
      : "not found",
  });

  tools.push({
    name: "GitHub Copilot",
    detected: existsSync(join(cwd, ".github")),
    reason: existsSync(join(cwd, ".github"))
      ? ".github/ directory found"
      : "not found",
  });

  const clineDetected =
    existsSync(join(cwd, ".cline")) || existsSync(join(cwd, ".clinerules"));
  tools.push({
    name: "Cline",
    detected: clineDetected,
    reason: clineDetected
      ? existsSync(join(cwd, ".cline"))
        ? ".cline/ directory found"
        : ".clinerules found"
      : "not found",
  });

  return tools;
}

function generateConfigs(cwd: string, tools: DetectedTool[]): GeneratedFile[] {
  const generated: GeneratedFile[] = [];

  for (const tool of tools) {
    if (!tool.detected) continue;

    switch (tool.name) {
      case "Claude Code": {
        const settingsPath = join(cwd, ".claude", "settings.json");
        if (existsSync(settingsPath)) {
          generated.push({
            path: ".claude/settings.json",
            description: "already exists, skipped",
          });
        } else {
          mkdirSync(join(cwd, ".claude"), { recursive: true });
          const settings = {
            hooks: {
              PostToolUse: [
                {
                  matcher: "Edit|Write|MultiEdit",
                  hooks: [
                    {
                      type: "command",
                      command: SCAN_CMD,
                    },
                  ],
                },
              ],
            },
          };
          writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
          generated.push({
            path: ".claude/settings.json",
            description: "PostToolUse hook (blocks on findings)",
          });
        }
        break;
      }

      case "Cursor": {
        mkdirSync(join(cwd, ".cursor"), { recursive: true });
        const hooksPath = join(cwd, ".cursor", "hooks.json");
        const hooks = {
          hooks: {
            afterFileEdit: [{ command: SCAN_CMD }],
          },
        };
        writeFileSync(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);
        generated.push({
          path: ".cursor/hooks.json",
          description: "afterFileEdit hook",
        });

        mkdirSync(join(cwd, ".cursor", "rules"), { recursive: true });
        const rulesPath = join(cwd, ".cursor", "rules", "vibecop.md");
        const rulesContent = `---
trigger: always_on
---

After every code edit, review vibecop findings and fix issues before proceeding.
Run: ${SCAN_CMD}
`;
        writeFileSync(rulesPath, rulesContent);
        generated.push({
          path: ".cursor/rules/vibecop.md",
          description: "always-on lint rule",
        });
        break;
      }

      case "Codex CLI": {
        mkdirSync(join(cwd, ".codex"), { recursive: true });
        const codexPath = join(cwd, ".codex", "hooks.json");
        const codexHooks = {
          hooks: {
            PostToolUse: [
              {
                matcher: "Edit|Write|MultiEdit",
                hooks: [
                  {
                    type: "command",
                    command: SCAN_CMD,
                  },
                ],
              },
            ],
          },
        };
        writeFileSync(codexPath, `${JSON.stringify(codexHooks, null, 2)}\n`);
        generated.push({
          path: ".codex/hooks.json",
          description: "PostToolUse hook (blocks on findings)",
        });
        break;
      }

      case "Aider": {
        const aiderPath = join(cwd, ".aider.conf.yml");
        const aiderContent = `lint-cmd:
  - "typescript: npx vibecop scan --format text"
  - "javascript: npx vibecop scan --format text"
  - "python: npx vibecop scan --format text"
auto-lint: true
`;
        writeFileSync(aiderPath, aiderContent);
        generated.push({
          path: ".aider.conf.yml",
          description: "lint-cmd per language",
        });
        break;
      }

      case "Windsurf": {
        mkdirSync(join(cwd, ".windsurf", "rules"), { recursive: true });
        const windsurfPath = join(cwd, ".windsurf", "rules", "vibecop.md");
        const windsurfContent = `---
trigger: always_on
---

After every code edit, review vibecop findings and fix issues before proceeding.
Run: ${SCAN_CMD}
`;
        writeFileSync(windsurfPath, windsurfContent);
        generated.push({
          path: ".windsurf/rules/vibecop.md",
          description: "always-on lint rule",
        });
        break;
      }

      case "GitHub Copilot": {
        mkdirSync(join(cwd, ".github"), { recursive: true });
        const copilotPath = join(cwd, ".github", "copilot-instructions.md");
        const vibecopSection = `
## vibecop

After every code edit, run \`${SCAN_CMD}\` and fix any findings before proceeding.
`;

        if (existsSync(copilotPath)) {
          const existing = readFileSync(copilotPath, "utf-8");
          if (existing.includes("vibecop")) {
            generated.push({
              path: ".github/copilot-instructions.md",
              description: "already contains vibecop, skipped",
            });
          } else {
            writeFileSync(copilotPath, existing + vibecopSection);
            generated.push({
              path: ".github/copilot-instructions.md",
              description: "appended vibecop instructions",
            });
          }
        } else {
          writeFileSync(copilotPath, vibecopSection);
          generated.push({
            path: ".github/copilot-instructions.md",
            description: "copilot instructions",
          });
        }
        break;
      }

      case "Cline": {
        const clinePath = join(cwd, ".clinerules");
        const clineContent = `After every code edit, run \`${SCAN_CMD}\` and fix any findings before proceeding.\n`;
        writeFileSync(clinePath, clineContent);
        generated.push({
          path: ".clinerules",
          description: "always-on lint rule",
        });
        break;
      }
    }
  }

  return generated;
}

function padEnd(str: string, len: number): string {
  return str + " ".repeat(Math.max(0, len - str.length));
}

export async function runInit(cwd?: string): Promise<void> {
  const root = cwd ?? process.cwd();

  console.log("");
  console.log("  vibecop — agent integration setup");
  console.log("");

  const tools = detectTools(root);
  const anyDetected = tools.some((t) => t.detected);

  if (!anyDetected) {
    console.log("  No supported AI coding tools detected.");
    console.log("  See docs/agent-integration.md for manual setup.");
    console.log("");
    return;
  }

  console.log("  Detected tools:");
  for (const tool of tools) {
    const icon = tool.detected ? "\u2713" : "\u2717";
    console.log(`    ${icon} ${tool.name} (${tool.reason})`);
  }
  console.log("");

  const generated = generateConfigs(root, tools);

  if (generated.length > 0) {
    const maxPath = Math.max(...generated.map((g) => g.path.length));
    console.log("  Generated:");
    for (const file of generated) {
      console.log(
        `    ${padEnd(file.path, maxPath)}  — ${file.description}`,
      );
    }
    console.log("");
  }

  console.log(
    "  Done! vibecop will now run automatically in your agent workflow.",
  );
  console.log("");
}
