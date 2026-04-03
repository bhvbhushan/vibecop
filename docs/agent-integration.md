# Agent Integration

vibecop integrates with AI coding agents as an automatic linter that runs after every code edit. The agent reads findings from stdout and self-corrects before proceeding.

## Quick Start

Run the setup wizard to auto-detect your tools and generate config files:

```bash
npx vibecop init
```

This detects installed/active tools and writes the appropriate config files to your project. For manual setup, copy the relevant files from the [`examples/`](../examples/) directory.

## How It Works

vibecop plugs into agent hook systems. After each file edit, the hook fires `npx vibecop scan`, which outputs findings the agent reads and resolves:

```
Agent generates code
  → Hook fires: npx vibecop scan --diff HEAD --format agent
  → stdout: one-per-line findings (exit 1)
  → Agent reads findings, auto-corrects code
  → Hook re-runs: clean (exit 0) → proceed
```

This creates a tight feedback loop: the agent never moves on while there are unresolved findings.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No findings — clean |
| `1` | One or more findings found |
| `2` | Scan error (bad args, git error, etc.) |

## Output Format

`--format agent` produces one finding per line, suitable for agent parsing:

```
file:line:col severity detector-id: message. suggestion
```

Example:

```
src/auth.ts:42:5 error no-hardcoded-secrets: Hardcoded secret detected. Move to environment variable.
src/utils.ts:18:1 warning dead-code: Unreachable code after return statement. Remove or restructure.
```

Fields:
- `file:line:col` — location
- `severity` — `error`, `warning`, or `info`
- `detector-id` — machine-readable rule ID
- `message` — human-readable description
- `suggestion` — how to fix it

## Tier 1 Tools — Deterministic Hooks

These tools support native hook execution. vibecop runs synchronously after each edit and blocks the agent until findings are resolved.

### Claude Code

Hook type: `PostToolUse` — fires after any `Edit`, `Write`, or `MultiEdit` tool call.

Create `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx vibecop scan --diff HEAD --format agent"
          }
        ]
      }
    ]
  }
}
```

Or copy from [`examples/claude-code/`](../examples/claude-code/).

### Cursor

Hook type: `afterFileEdit` — fires after any file save.

Create `.cursor/hooks.json`:

```json
{
  "hooks": {
    "afterFileEdit": [
      {
        "command": "npx vibecop scan --diff HEAD --format agent"
      }
    ]
  }
}
```

Also create `.cursor/rules/vibecop.md` to reinforce via the rules system:

```markdown
---
trigger: always_on
---

After every code edit, review vibecop findings and fix issues before proceeding.
Run: npx vibecop scan --diff HEAD --format agent
```

Or copy from [`examples/cursor/`](../examples/cursor/).

### Codex CLI

Hook type: `PostToolUse` — same structure as Claude Code.

Create `.codex/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx vibecop scan --diff HEAD --format agent"
          }
        ]
      }
    ]
  }
}
```

Or copy from [`examples/codex/`](../examples/codex/).

### Aider

Aider supports a `lint-cmd` config that runs after each edit. vibecop acts as the linter for TypeScript, JavaScript, and Python files.

Create `.aider.conf.yml`:

```yaml
lint-cmd:
  - "typescript: npx vibecop scan --format text"
  - "javascript: npx vibecop scan --format text"
  - "python: npx vibecop scan --format text"
auto-lint: true
```

Note: Aider uses `--format text` (not `agent`) since it reads linter output differently from streaming agents.

Or copy from [`examples/aider/`](../examples/aider/).

## Tier 2 Tools — LLM-Mediated Instructions

These tools do not have deterministic hook execution. Instead, vibecop is injected as a persistent instruction into the agent's context. The LLM follows the instruction voluntarily.

### GitHub Copilot

Add to `.github/copilot-instructions.md`:

```markdown
## vibecop

After every code edit, run `npx vibecop scan --diff HEAD --format agent` and fix any findings before proceeding.
```

If the file already exists, append the `## vibecop` section. `vibecop init` handles this automatically.

Or copy from [`examples/copilot/`](../examples/copilot/).

### Windsurf

Create `.windsurf/rules/vibecop.md`:

```markdown
---
trigger: always_on
---

After every code edit, review vibecop findings and fix issues before proceeding.
Run: npx vibecop scan --diff HEAD --format agent
```

Or copy from [`examples/windsurf/`](../examples/windsurf/).

### Cline

Create `.clinerules`:

```
After every code edit, run `npx vibecop scan --diff HEAD --format agent` and fix any findings before proceeding.
```

Or copy from [`examples/cline/`](../examples/cline/).

## Troubleshooting

### vibecop not found

If `npx vibecop` fails with "command not found", install it globally:

```bash
npm install -g vibecop
# then use: vibecop scan --diff HEAD --format agent
```

Or add it as a dev dependency:

```bash
npm install --save-dev vibecop
# npx will resolve it from node_modules
```

### No findings reported

Verify vibecop can see your changes:

```bash
git diff HEAD  # should show modified files
npx vibecop scan --diff HEAD --format agent
```

If there are no staged/unstaged changes, the scan has nothing to check. Make sure your agent's edits are tracked by git (the project must be a git repo).

### Hook timeout

If your hook system has a timeout (common in Cursor), vibecop should complete within a few seconds on most codebases. For large repos, scope the scan:

```bash
npx vibecop scan --diff HEAD --format agent --path src/
```

### Permission issues

On some systems, `npx` may require a PATH that includes the global npm bin. If the hook fires but `npx` is not found, use the full path:

```bash
$(npm root -g)/.bin/vibecop scan --diff HEAD --format agent
```

Or use `node_modules/.bin/vibecop` if installed locally.

## Configuration

Customize vibecop behavior via `.vibecop.yml` in your project root.

### Disable specific rules

```yaml
rules:
  no-hardcoded-secrets: off
  dead-code: warn
```

### Change severity

```yaml
rules:
  large-function: error   # escalate from warning
  console-log: off        # silence entirely
```

### Ignore paths

```yaml
ignore:
  - "**/*.test.ts"
  - "dist/**"
  - "node_modules/**"
```

### Full example

```yaml
rules:
  no-hardcoded-secrets: error
  dead-code: warn
  large-function: off

ignore:
  - "**/*.test.ts"
  - "dist/**"
```

Changes to `.vibecop.yml` take effect immediately — no restart needed.
