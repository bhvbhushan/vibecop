# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
