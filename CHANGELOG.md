# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-04-06

### Added

- **MCP Server** — `vibecop serve` starts an MCP server on stdio transport with 3 tools:
  - `vibecop_scan` — scan a directory for AI code quality issues
  - `vibecop_check` — check a single file for issues
  - `vibecop_explain` — explain what a detector checks for, its severity, and category
- New dependency: `@modelcontextprotocol/sdk` for MCP protocol support
- Engine API: exported `scan()` and `checkFile()` from `engine.ts` for programmatic use
- Docs: Tier 3 MCP setup in `docs/agent-integration.md`, Phase 3.5 in `docs/design.md`

### Fixed

- **debug-console-in-prod:** auto-detect CLI/server projects via `package.json` `bin` field and skip — servers legitimately use console.log. Reduced default flagged methods to `log` and `debug` only (was 8 methods). Made configurable via `.vibecop.yml` `methods` array
- **undeclared-import:** skip packages importing themselves — reads `package.json` `name` field for JS/TS, normalizes hyphens to underscores for Python pyproject.toml matching
- **placeholder-in-production:** skip fixture, example, sample, mock, demo directories and `.md` files

### Changed

- Refactored `cli.ts` — scan/check orchestration moved to `engine.ts`, CLI is now a thin layer

## [0.3.1] - 2026-04-04

### Fixed

- Add native binding `optionalDependencies` and install verification test

## [0.3.0] - 2026-04-04

### Added

- 6 test quality detectors: assertion-roulette, sleepy-test, snapshot-only-test, empty-test, conditional-test-logic, no-error-path-test
- Custom YAML rules via `.vibecop/rules/*.yaml` using ast-grep pattern syntax
- `vibecop test-rules` command to validate custom rules against inline examples
- GCC output format (`--format gcc`) for editor/IDE integration
- Test utility refactor: shared `findTestFunctions()`, `countJsAssertions()`, `countPyAssertions()`

### Fixed

- `double-type-assertion` detector rewritten to use AST (was regex-based, false positives on strings)

## [0.2.0] - 2026-04-03

### Added

- Agent integration: `vibecop init` auto-detects 7 AI coding tools and generates config files
- 6 new LLM/agent safety detectors: unsafe-shell-exec, llm-call-no-timeout, dynamic-code-exec, llm-unpinned-model, llm-no-system-message, llm-temperature-not-set
- Hallucinated package detector with bundled npm top-5K allowlist
- Agent output format (`--format agent`): one finding per line, token-efficient
- Engine dedup with `DetectorMeta.priority` — keeps highest-priority finding per file:line

## [0.1.2] - 2026-04-02

### Fixed

- Reduce npm package size from 19.7 MB to 115 KB — exclude `dist/action/` (GitHub Action bundle with native binaries) from npm tarball; only ship `dist/cli.js`

## [0.1.1] - 2026-04-02

### Fixed

- Fix native binding error when installed via npm — externalize `@ast-grep/napi` so platform-specific binaries resolve from `node_modules` at runtime
- Move `@actions/core` and `@actions/github` to devDependencies — CLI users no longer install unused GitHub Action deps

## [0.1.0] - 2026-04-01 -- Initial Release

### Added

- CLI tool `vibecop scan` with 22 detectors across 4 categories:
  - **Quality (12):** god-function, god-component, n-plus-one-query, unbounded-query, debug-console-in-prod, dead-code-path, double-type-assertion, excessive-any, todo-in-production, empty-error-handler, excessive-comment-ratio, over-defensive-coding
  - **Security (5):** sql-injection, dangerous-inner-html, token-in-localstorage, placeholder-in-production, insecure-defaults
  - **Correctness (3):** unchecked-db-result, undeclared-import, mixed-concerns
  - **Testing (2):** trivial-assertion, over-mocking
- 5 output formats: text, json, html, sarif, github
- `.vibecop.yml` configuration with per-rule severity overrides and ignore patterns
- PR Gate GitHub Action (`action.yml`) with inline review comments
  - 4 failure modes: comment-only, request-changes, label, auto-close
  - Severity threshold filtering
  - Diff-aware inline comments (only on changed lines)
- Language support: TypeScript, JavaScript, Python
- Monorepo support for undeclared-import detection
- Real-world benchmarks against 10 vibe-coded open-source projects
