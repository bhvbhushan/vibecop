# vibecop

[![license](https://img.shields.io/npm/l/vibecop)](https://github.com/bhvbhushan/vibecop/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![CI](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml/badge.svg)](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml)
[![Playground](https://img.shields.io/badge/Try-Playground-orange)](https://vibecop-pg.bhvbhushan7.com/)

AI code quality toolkit — deterministic linter for the AI coding era. 28 detectors catch the bugs AI agents introduce: god functions, N+1 queries, unsafe shell exec, unpinned LLM models, and more. Runs automatically inside Claude Code, Cursor, Codex, Aider, and 3 other AI tools via `vibecop init`.

Built on [ast-grep](https://ast-grep.github.io/) for fast, tree-sitter-based AST analysis. No LLM required — every finding is deterministic and reproducible.

## Try it Online

**[Playground](https://vibecop-pg.bhvbhushan7.com/)** — paste code and scan instantly in your browser.

## Install

```bash
# npm
npm install -g vibecop

# bun (recommended)
bun add -g vibecop
```

Requires Node.js >= 20 or Bun >= 1.0.

## Quick Start

```bash
# Scan current directory
vibecop scan .

# Scan specific directory with JSON output
vibecop scan src/ --format json

# Check what detectors are available
vibecop check

# CI mode — exit code 1 if errors found
vibecop scan . --format text

# Scan with custom config
vibecop scan . --config .vibecop.yml
```

## Agent Integration

vibecop runs automatically inside your AI coding agent. Every time the agent edits a file, vibecop scans the change and blocks on findings — the agent reads the output and fixes the issue before proceeding.

### Auto-setup (recommended)

```bash
npx vibecop init
```

Detects which tools you have installed and generates the right config files:

```
  vibecop — agent integration setup

  Detected tools:
    ✓ Claude Code (.claude/ directory found)
    ✓ Cursor (.cursor/ directory found)
    ✓ Aider (aider installed)
    ✗ Codex CLI (not found)

  Generated:
    .claude/settings.json     — PostToolUse hook (blocks on findings)
    .cursor/hooks.json        — afterFileEdit hook
    .cursor/rules/vibecop.md  — always-on lint rule
    .aider.conf.yml           — lint-cmd per language

  Done! vibecop will now run automatically in your agent workflow.
```

### Supported tools

| Tool | Integration | How it works |
|------|-------------|--------------|
| **Claude Code** | PostToolUse hook | Runs after every Edit/Write, exit 1 blocks and forces fix |
| **Cursor** | afterFileEdit hook + rules | Hook runs scan, rules file tells agent to fix findings |
| **Codex CLI** | PostToolUse hook | Same pattern as Claude Code |
| **Aider** | Native `--lint-cmd` | Built-in lint integration, runs after every edit |
| **GitHub Copilot** | Custom instructions | Instructions file tells agent to run vibecop |
| **Windsurf** | Rules file | `trigger: always_on` rule |
| **Cline/Roo Code** | `.clinerules` | Rules file tells agent to run vibecop |

### Manual setup (Claude Code example)

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [{
        "type": "command",
        "command": "npx vibecop scan --diff HEAD --format agent"
      }]
    }]
  }
}
```

### How the loop works

```
Agent writes code
  → vibecop hook fires automatically
  → Findings? Exit 1 → agent reads output, fixes code
  → No findings? Exit 0 → agent continues
```

The `--format agent` output is token-efficient (one finding per line, ~30 tokens each):

```
src/api.ts:42:1 error unsafe-shell-exec: execSync() with template literal. Use execFile() with argument array instead.
src/llm.ts:18:5 warning llm-unpinned-model: Unpinned model alias "gpt-4o". Pin to a dated version like "gpt-4o-2024-08-06".
```

See [docs/agent-integration.md](docs/agent-integration.md) for full setup instructions and troubleshooting.

## Benchmarks

### Vibe-coded vs established: finding density comparison

All numbers below are real — run `vibecop scan` on any of these repos yourself to reproduce. Finding density = findings per 1,000 lines of code.

**Established projects (professionally maintained):**

| Project | Stars | Files | LOC | Findings | Density |
|---------|:-----:|:-----:|----:|:--------:|--------:|
| [**fastify**](https://github.com/fastify/fastify) | 65K | 275 | 74,428 | 124 | 1.7/kLOC |
| [**date-fns**](https://github.com/date-fns/date-fns) | 35K | 1,543 | 99,859 | 308 | 3.1/kLOC |
| [**TanStack/query**](https://github.com/TanStack/query) | 43K | 997 | 148,492 | 652 | 4.4/kLOC |
| [**express**](https://github.com/expressjs/express) | 66K | 141 | 21,346 | 123 | 5.8/kLOC |
| [**zod**](https://github.com/colinhacks/zod) | 35K | 356 | 70,886 | 964 | 13.6/kLOC |

**Vibe-coded projects (AI-generated/assisted):**

| Project | Stars | Files | LOC | Findings | Density |
|---------|:-----:|:-----:|----:|:--------:|--------:|
| [**dyad**](https://github.com/dyad-sh/dyad) | 20K | 956 | 147,284 | 1,179 | 8.0/kLOC |
| [**bolt.diy**](https://github.com/stackblitz-labs/bolt.diy) | 19.2K | 392 | 71,639 | 977 | 13.6/kLOC |
| [**code-review-graph**](https://github.com/tirth8205/code-review-graph) | 3.9K | 95 | 27,119 | 361 | 13.3/kLOC |
| [**context7**](https://github.com/upstash/context7) | 51.3K | 71 | 9,201 | 129 | 14.0/kLOC |
| [**vibe-check-mcp**](https://github.com/PV-Bhat/vibe-check-mcp-server) | 480 | 55 | 5,964 | 119 | 20.0/kLOC |
| [**magic-mcp**](https://github.com/21st-dev/magic-mcp) | 4.6K | 14 | 1,096 | 28 | 25.5/kLOC |
| [**browser-tools-mcp**](https://github.com/AgentDeskAI/browser-tools-mcp) | 7.2K | 12 | 8,346 | 414 | 49.6/kLOC |

**Median density: established 4.4/kLOC vs vibe-coded 14.0/kLOC (3.2x higher).** Vibe-coded projects consistently trigger more findings per line of code. The v0.2 detectors found **157 additional issues** across vibe-coded repos that v0.1 missed: 63 unsafe shell executions, 53 unpinned LLM models, 39 missing system messages.

> **Note:** Some established repos show higher-than-expected density for valid reasons — zod uses `any` deliberately for type gymnastics (634 of its 964 findings), date-fns has extensive JSDoc (218 comment-ratio findings). vibecop detects patterns, not intent. Use `.vibecop.yml` to tune or disable detectors for your codebase.

### Example Output

```
src/services/user.service.ts
  45:1    error    Function 'processUserData' is too complex (232 lines, cyclomatic complexity 41, 3 params)  god-function
  89:5    warning  Database or API call inside a loop — potential N+1 query  n-plus-one-query
  145:5   warning  Database mutation result is not checked — errors will be silently ignored  unchecked-db-result

src/components/PaymentModal.tsx
  1:1     warning  Component has too many hooks (8 useState, 3 useEffect, 593 lines)  god-component
  201:9   warning  dangerouslySetInnerHTML can lead to XSS attacks if the content is not sanitized  dangerous-inner-html

src/config/auth.ts
  12:5    error    Placeholder placeholder domain found: "yourdomain.com"  placeholder-in-production
  18:5    error    Auth token stored in localStorage — vulnerable to XSS  token-in-localstorage

src/utils/api.ts
  34:12   warning  Double type assertion (as unknown as X) bypasses TypeScript's type safety  double-type-assertion
  67:1    info     TODO comment in production code (security-related)  todo-in-production

✖ 9 problems (3 errors, 5 warnings, 1 info)
```

## Detectors (28 total)

### Quality (16 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `god-function` | God Function | Functions exceeding line, complexity, or parameter thresholds | error/warning |
| `god-component` | God Component | React components with too many hooks, lines, or imports | warning |
| `n-plus-one-query` | N+1 Query | DB/API calls inside loops or `.map(async ...)` callbacks | warning |
| `unbounded-query` | Unbounded Query | `findMany`/`findAll` without a `take`/`limit` clause | info |
| `debug-console-in-prod` | Debug Console in Prod | `console.log`/`console.debug` left in production code | warning |
| `dead-code-path` | Dead Code Path | Identical if/else branches, unreachable code after return/throw | warning |
| `double-type-assertion` | Double Type Assertion | `as unknown as X` patterns that bypass TypeScript type safety | warning |
| `excessive-any` | Excessive Any | Files with 4+ `any` type annotations | warning |
| `todo-in-production` | TODO in Production | TODO/FIXME/HACK comments, escalated if security-related | info/warning |
| `empty-error-handler` | Empty Error Handler | Catch/except blocks that silently swallow errors | warning |
| `excessive-comment-ratio` | Excessive Comment Ratio | Files with >50% comment lines | info |
| `over-defensive-coding` | Over-Defensive Coding | Redundant null checks on values that can't be null | info |
| `llm-call-no-timeout` | LLM Call No Timeout | `new OpenAI()`/`new Anthropic()` without timeout, `.create()` without max_tokens | warning |
| `llm-unpinned-model` | LLM Unpinned Model | Moving model aliases like `"gpt-4o"` that silently change behavior | warning |
| `llm-temperature-not-set` | LLM Temperature Not Set | LLM `.create()` calls without explicit `temperature` parameter | info |
| `llm-no-system-message` | LLM No System Message | Chat API calls without a `role: "system"` message | info |

### Security (7 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `sql-injection` | SQL Injection | Template literals or string concatenation in SQL query methods | error |
| `dangerous-inner-html` | Dangerous innerHTML | `dangerouslySetInnerHTML` usage without sanitization | warning |
| `token-in-localstorage` | Token in localStorage | Auth/JWT tokens stored in XSS-accessible storage | error |
| `placeholder-in-production` | Placeholder in Production | `yourdomain.com`, `changeme`, `xxx` left in config | error |
| `insecure-defaults` | Insecure Defaults | `eval()`, `rejectUnauthorized: false`, hardcoded credentials | error |
| `unsafe-shell-exec` | Unsafe Shell Exec | `exec()`/`execSync()` with dynamic args, `subprocess` with `shell=True` | error |
| `dynamic-code-exec` | Dynamic Code Exec | `eval(variable)`, `new Function(variable)` with non-literal arguments | error |

### Correctness (4 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `unchecked-db-result` | Unchecked DB Result | Fire-and-forget database mutations (insert/update/delete) | warning |
| `undeclared-import` | Undeclared Import | Imports not declared in package.json/requirements.txt | error |
| `mixed-concerns` | Mixed Concerns | Files importing both UI frameworks and database/server libraries | warning |
| `hallucinated-package` | Hallucinated Package | Dependencies not in top-5K npm allowlist (potential AI hallucination) | info |

### Testing (2 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `trivial-assertion` | Trivial Assertion | `expect(true).toBe(true)` and similar no-op tests | info |
| `over-mocking` | Over-Mocking | Test files with excessive mock/spy usage | info |

## GitHub Action

Add vibecop as a PR gate that posts inline review comments on changed lines:

```yaml
# .github/workflows/vibecop.yml
name: vibecop
on: [pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bhvbhushan/vibecop@main
        with:
          on-failure: comment-only    # or: request-changes, label, auto-close
          severity-threshold: warning
          max-findings: 50
```

### Action Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | `${{ github.token }}` |
| `config` | Path to `.vibecop.yml` config file | `.vibecop.yml` |
| `on-failure` | Action on findings: `comment-only`, `request-changes`, `label`, `auto-close` | `comment-only` |
| `label` | Label to apply when `on-failure` is `label` | `vibecop:needs-review` |
| `max-findings` | Maximum findings to report (0 = unlimited) | `50` |
| `severity-threshold` | Minimum severity for inline comments (`error`, `warning`, `info`) | `warning` |
| `working-directory` | Directory to scan (relative to repo root) | `.` |

### Action Outputs

| Output | Description |
|--------|-------------|
| `findings-count` | Total number of findings |
| `errors-count` | Number of error-severity findings |
| `warnings-count` | Number of warning-severity findings |
| `has-findings` | Whether any findings were detected (`true`/`false`) |
| `scan-time-ms` | Scan duration in milliseconds |

## Configuration

Create `.vibecop.yml` in your project root:

```yaml
rules:
  god-function:
    severity: warning
  debug-console-in-prod:
    severity: "off"        # disable a detector
  excessive-any:
    severity: warning

ignore:
  - "**/dist/**"
  - "**/vendor/**"
  - "**/generated/**"

pr-gate:
  on-failure: request-changes
  severity-threshold: warning
  max-findings: 50
  label: "vibecop:needs-review"
```

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--format` | Output format: `text`, `json`, `html`, `sarif`, `github`, `agent` | `text` |
| `--config` | Path to config file | `.vibecop.yml` |
| `--no-config` | Ignore config file | |
| `--max-findings` | Maximum findings to report | `100` |
| `--output` | Write report to file | |

## Languages

| Language | Extensions | Detectors |
|----------|-----------|-----------|
| TypeScript | `.ts`, `.tsx` | All 28 |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | 24 (excludes TS-specific) |
| Python | `.py` | 14 (correctness, quality, security) |

## Architecture

```
vibecop CLI (Commander)
+-- Scan Engine           -- discovers files, loads AST, runs detectors, dedup by priority
+-- Init Wizard           -- auto-detects AI tools, generates hook/rule configs
+-- Config Loader (Zod)   -- validates .vibecop.yml, merges defaults, per-rule config
+-- Detectors (28)        -- AST pattern matching via ast-grep (@ast-grep/napi)
+-- Formatters (6)        -- text, json, html, sarif, github, agent output
+-- Project Analyzer      -- parses package.json, requirements.txt, lockfiles
+-- GitHub Action          -- diff parser, finding filter, PR review poster
```

## Versioning

vibecop follows [Semantic Versioning](https://semver.org/):

- **0.x.y** ... pre-1.0, the API may change between minor versions
- **PATCH** (0.x.Y) ... bug fixes, new detectors, doc updates
- **MINOR** (0.X.0) ... new detector categories, output formats, config options
- **MAJOR** (X.0.0) ... breaking CLI changes, removed detectors, config format changes

## Roadmap

- [x] **Phase 1**: Core scanner with 7 detectors, 5 output formats, `.vibecop.yml` config
- [x] **Phase 2**: PR Gate GitHub Action, 15 new detectors (7 → 22), real-world validation
- [x] **Phase 2.5**: Agent integration (7 tools), 6 LLM/agent detectors (22 → 28), `vibecop init`, `--format agent`
- [ ] **Phase 3**: MCP server, VS Code extension, cross-file analysis
- [ ] **Phase 4**: LLM-powered deep review mode (separation of concerns, semantic duplication)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and how to add new detectors.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
