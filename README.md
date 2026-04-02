# vibecop

[![license](https://img.shields.io/npm/l/vibecop)](https://github.com/bhvbhushan/vibecop/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![CI](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml/badge.svg)](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml)
[![Playground](https://img.shields.io/badge/Try-Playground-orange)](https://vibecop-pg.bhvbhushan7.com/)

AI code quality toolkit — deterministic linter for the AI coding era. Catches the bugs that AI agents introduce: god functions, N+1 queries, fire-and-forget DB calls, leftover debug logging, and 18 more patterns. Like `eslint` for structural quality, but focused on the antipatterns AI generates.

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

## Benchmarks

Tested against 10 popular open-source vibe-coded projects (April 2026). These are real results, not synthetic:

| Project | Stars | Files | Findings | Key Issues Found |
|---------|:-----:|:-----:|:--------:|------------------|
| [**context7**](https://github.com/upstash/context7) | 51.3K | 68 | 118 | 71 console.logs, 21 god functions, 3 N+1 queries |
| [**dyad**](https://github.com/dyad-sh/dyad) | 20K | 970 | 1,104 | 402 god functions, 47 unchecked DB results, 12 placeholder values |
| [**bolt.diy**](https://github.com/stackblitz-labs/bolt.diy) | 19.2K | 398 | 949 | 294 `any` types, 9 `dangerouslySetInnerHTML`, 24 N+1 queries |
| [**screenpipe**](https://github.com/screenpipe/screenpipe) | 17.9K | 362 | 1,340 | 387 `any` types, 236 empty error handlers, 3 dead code paths |
| [**browser-tools-mcp**](https://github.com/AgentDeskAI/browser-tools-mcp) | 7.2K | 12 | 420 | 319 console.logs, 49 `any` types, 15 empty error handlers |
| [**magic-mcp**](https://github.com/21st-dev/magic-mcp) | 4.6K | 14 | 28 | 22 console.logs, 3 empty error handlers, 3 god functions |
| [**code-review-graph**](https://github.com/tirth8205/code-review-graph) | 3.9K | 94 | 410 | 139 unchecked DB results, 71 N+1 queries, 6 SQL injections |
| [**vibe-check-mcp**](https://github.com/PV-Bhat/vibe-check-mcp-server) | 480 | 53 | 113 | 74 console.logs, 18 `any` types, 9 god functions |
| [**codeledger**](https://github.com/bhvbhushan/codeledger) | 3 | 54 | 30 | 13 god functions, 6 SQL injections, 5 `any` types |
| [**mcptest**](https://github.com/bhvbhushan/mcptest) | — | 37 | 1 | 1 god function |

**4,513 findings** across **2,062 files** in 10 vibe-coded projects. Most common antipatterns: god functions (38%), excessive `any` (21%), leftover `console.log` (26%).

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

## Detectors (22 total)

### Quality (12 detectors)

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

### Security (5 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `sql-injection` | SQL Injection | Template literals or string concatenation in SQL query methods | error |
| `dangerous-inner-html` | Dangerous innerHTML | `dangerouslySetInnerHTML` usage without sanitization | warning |
| `token-in-localstorage` | Token in localStorage | Auth/JWT tokens stored in XSS-accessible storage | error |
| `placeholder-in-production` | Placeholder in Production | `yourdomain.com`, `changeme`, `xxx` left in config | error |
| `insecure-defaults` | Insecure Defaults | `eval()`, `rejectUnauthorized: false`, hardcoded credentials | error |

### Correctness (3 detectors)

| ID | Detector | Description | Severity |
|----|----------|-------------|----------|
| `unchecked-db-result` | Unchecked DB Result | Fire-and-forget database mutations (insert/update/delete) | warning |
| `undeclared-import` | Undeclared Import | Imports not declared in package.json/requirements.txt | error |
| `mixed-concerns` | Mixed Concerns | Files importing both UI frameworks and database/server libraries | warning |

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
| `--format` | Output format: `text`, `json`, `html`, `sarif`, `github` | `text` |
| `--config` | Path to config file | `.vibecop.yml` |
| `--no-config` | Ignore config file | |
| `--max-findings` | Maximum findings to report | `100` |
| `--output` | Write report to file | |

## Languages

| Language | Extensions | Detectors |
|----------|-----------|-----------|
| TypeScript | `.ts`, `.tsx` | All 22 |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | 18 (excludes TS-specific) |
| Python | `.py` | 10 (correctness, quality, security) |

## Architecture

```
vibecop CLI (Commander)
+-- Scan Engine           -- discovers files, loads AST, runs detectors, collects findings
+-- Config Loader (Zod)   -- validates .vibecop.yml, merges defaults, per-rule config
+-- Detectors (22)        -- AST pattern matching via ast-grep (@ast-grep/napi)
+-- Formatters (5)        -- text, json, csv, html, sarif output
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
- [x] **Phase 2**: PR Gate GitHub Action, 15 new detectors (7 → 22), monorepo support, real-world validation
- [ ] **Phase 3**: Cross-file analysis (duplicate code detection, repeated constants), npm publish
- [ ] **Phase 4**: LLM-powered deep review mode (separation of concerns, semantic duplication)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code standards, and how to add new detectors.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
