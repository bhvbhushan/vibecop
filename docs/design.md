# aiqt — AI Code Quality Toolkit: Design & Implementation Plan

**Date:** 2026-04-01
**Status:** Engineering Review Complete / Ready for Implementation

---

## Overview

The open-source linter purpose-built for the AI coding era. Detects AI-specific code antipatterns that traditional tools miss: hallucinated imports, over-mocking, trivial assertions, insecure defaults, excessive comments. Runs in CI in under 60 seconds, requires no API keys, fully deterministic, zero network calls.

## Problem Statement

- AI-generated code has 1.7x more issues per PR than human code (CodeRabbit, 470 PRs)
- 4x maintenance costs by year 2 for unmanaged AI code
- 19.7% of AI-suggested packages are hallucinations (USENIX Security 2025)
- 90%+ of AI code issues are code smells
- OSS maintainers drowning in AI slop PRs (Curl, Jazzband, Godot, tldraw affected)

## Gaps Addressed

- **Gap 1 (AI Slop Defense):** PR quality gate for OSS maintainers
- **Gap 2 (AI Code Debt Scanner):** Codebase scanner for AI-generated tech debt
- **Gap 6 (AI Test Quality Evaluator):** Meaningful coverage scoring for AI-generated tests (Phase 3)

---

## Competitive Analysis

| Tool | Code Analysis | AI-Specific | PR Gate | CLI Scan | Test Quality | OSS |
|------|:-:|:-:|:-:|:-:|:-:|:-:|
| anti-slop | No | Metadata only | Yes | No | No | Yes |
| AI-SLOP-Detector | Yes | Yes (Python) | No | Yes | No | Yes |
| SonarQube CE | Yes | No (paid only) | Partial | Yes | No | Yes |
| Qodo/PR-Agent | LLM-based | No | Yes | No | Partial | Yes |
| Semgrep | Yes | No catalog | No | Yes | No | Yes |
| **aiqt** | **Yes** | **Yes (core)** | **Yes** | **Yes** | **Yes** | **Yes** |

### Key Competitor Details

**Anti-Slop (peakoss/anti-slop):** 31 checks across 8 categories — ALL metadata-level (PR title, description, account age, commit format). Zero code content analysis. Built by Coolify maintainers handling 120+ slop PRs/month.

**AI-SLOP-Detector (flamehaven01):** Python CLI using Logic Density Ratio, Buzzword Inflation, Unused Dependencies metrics. Self-calibrating weights. Python-primary only, no PR gate.

**SonarQube:** AI Code Assurance exists but is paid-only (Server/Cloud editions). Community Edition has zero AI-specific features.

**PR-Agent (Qodo):** LLM-powered = non-deterministic, costly, latency. Highest F1 (60.1%) on code review benchmark but generates noise.

---

## Academic Research Foundation

1. **SpecDetect4AI** (arxiv 2509.20491) — 22 AI-specific code smells, 88.66% precision. Declarative DSL with first-order AST predicates. **Architecture reference.**
2. **SpecDetect4LLM** (arxiv 2512.18020) — 5 LLM-specific code smells, 60.50% of systems affected, 86.06% precision.
3. **Slopsquatting** (USENIX Security 2025) — 576K code samples, 16 LLMs: 19.7% hallucinated packages. 43% consistently hallucinated across prompts.
4. **AI Detection Unreliable** (arxiv 2411.04299) — Stylometric authorship detection fails. Focus on quality patterns, not authorship.

---

## Engineering Review Decisions

The following 10 decisions were finalized during engineering and CEO review and supersede all earlier design notes:

1. **Parser: @ast-grep/napi** — 13K stars, 9 platform binaries, 10-50x faster than raw tree-sitter, ships pre-built native binaries via napi-rs. tree-sitter is NOT used directly.
2. **Single package** — No monorepo, no `@aiqt/cli` / `@aiqt/core` split. Single `aiqt` npm package.
3. **Bun for build/test/run** — `bun test` (not Vitest), `bun build` (not tsup). Node.js 20+ for end-user runtime compatibility.
4. **Text-default output** — Text is the default `--format`. SARIF is optional, not primary.
5. **7 detectors for v0.1** — Scope is fixed: undeclared-import, empty-error-handler, trivial-assertion, excessive-comment-ratio, over-defensive-coding, insecure-defaults, over-mocking.
6. **Lock-file validation (no network)** — Parse `package.json`, lock files, and `requirements.txt` to answer "Is this import declared?" Zero network calls, zero overhead.
7. **Deferred detectors** — hallucinated-api-call, copy-paste-duplication, tautological-test, over-abstraction, buzzword-comments are explicitly out of v0.1 scope.
8. **No YAML rule format in v0.1** — All 7 detectors are implemented in TypeScript. No YAML DSL in this version.
9. **Config: `.aiqt.yml`** — Loaded at startup, validated with Zod, minimal schema.
10. **Languages v0.1: JS, TS, TSX, Python** — JS/TS/TSX built-in to @ast-grep/napi; Python via `@ast-grep/lang-python` + `registerDynamicLanguage()`.

---

## Architecture

### File Layout

```
aiqt/                           ← single npm package
├── src/
│   ├── cli.ts                  ← Commander.js entry (scan, check commands)
│   ├── engine.ts               ← File discovery, detector runner, report builder
│   ├── config.ts               ← .aiqt.yml loading + Zod validation
│   ├── project.ts              ← Parse package.json, lock files, manifests → ProjectInfo
│   ├── formatters/
│   │   ├── text.ts             ← Default: stylish terminal output
│   │   ├── json.ts             ← Programmatic JSON
│   │   ├── sarif.ts            ← Optional SARIF 2.1.0 (~80 LOC hand-rolled)
│   │   ├── github.ts           ← ::error annotations + GITHUB_STEP_SUMMARY
│   │   └── html.ts             ← Single-file HTML report
│   ├── detectors/
│   │   ├── undeclared-import.ts
│   │   ├── empty-error-handler.ts
│   │   ├── trivial-assertion.ts
│   │   ├── excessive-comment-ratio.ts
│   │   ├── over-defensive-coding.ts
│   │   ├── insecure-defaults.ts
│   │   └── over-mocking.ts
│   └── types.ts                ← Detector, DetectionContext, Finding, ProjectInfo, etc.
├── test/
├── package.json
├── tsconfig.json
├── .aiqt.yml                   ← Self-dogfood config
└── docs/
    └── design.md               ← This file
```

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 20+ / bun | bun for dev, Node for broad end-user compat |
| Language | TypeScript | Type safety for AST operations |
| Parser | @ast-grep/napi | 13K stars, 9 platform binaries, 10-50x faster than raw tree-sitter |
| Lang: Python | @ast-grep/lang-python | One import + `registerDynamicLanguage()` |
| CLI | Commander.js | Standard, widely understood |
| Config validation | Zod | Schema validation with good error messages |
| Output: SARIF | @types/sarif (types only) | Hand-roll ~80 LOC serializer, no runtime dep |
| Test | bun test | Built-in, no extra dependency |
| Build | bun build | Built-in |
| Distribution | npm (`npx aiqt scan`) | Largest reach |

---

## Core Interfaces

```typescript
interface Detector {
  id: string;
  meta: DetectorMeta;
  detect(ctx: DetectionContext): Finding[];
}

interface DetectorMeta {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  category: 'correctness' | 'quality' | 'security' | 'testing';
  languages: Lang[];
}

interface DetectionContext {
  file: FileInfo;
  root: SgRoot;              // ast-grep root node
  source: string;            // raw file text
  project: ProjectInfo;      // dependencies, lock file data
  config: RuleConfig;        // per-rule config overrides
}

interface Finding {
  detectorId: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  suggestion?: string;
}

interface ProjectInfo {
  dependencies: Set<string>;
  devDependencies: Set<string>;
  manifests: string[];
}
```

---

## Data Flow

```
CLI args
  → loadConfig(.aiqt.yml or defaults)
  → loadProjectInfo(package.json, lock files, requirements.txt, pyproject.toml)
  → discoverFiles(path, config.ignore, .gitignore)
  → for each file:
      → parse with ast-grep (language auto-detected from extension)
      → run each enabled detector(ctx) → Finding[]
      → isolate: if detector throws, log error, continue
  → aggregate all findings
  → apply --max-findings N cap (default 50)
  → format(findings, --format flag)
  → exit(findings.length > 0 ? 1 : 0)
```

---

## CLI Commands (v0.1)

```
aiqt scan [path]
  # Scan directory (default: cwd)
  --format text|json|github|sarif|html   (default: text)
  --config <path>
  --no-config
  --max-findings N                        (default: 50)
  --verbose                               (timing summary)
  --diff <ref>                            (scan only changed files vs git ref)
  --stdin-files                           (read file list from stdin)

aiqt check <file>
  # Single file scan
  --format text|json|github|sarif|html
  --max-findings N
  --verbose
```

---

## v0.1 Detectors (7)

| # | Detector | Category | Severity | Key Pattern |
|---|----------|----------|----------|-------------|
| 1 | undeclared-import | correctness | error | Import not in package.json/lock file/requirements.txt |
| 2 | empty-error-handler | quality | warning | `catch(e) { console.log(e) }`, bare `except: pass` |
| 3 | trivial-assertion | testing | warning | `expect(true).toBe(true)`, `assert True` |
| 4 | excessive-comment-ratio | quality | info | comment LOC / code LOC > threshold (default 0.5) |
| 5 | over-defensive-coding | quality | info | Redundant null checks, unnecessary try/catch |
| 6 | insecure-defaults | security | error | Hardcoded secrets, `rejectUnauthorized: false`, `eval()` |
| 7 | over-mocking | testing | warning | mock/spy count > assertion count in test files |

### Detector Implementation Notes

**undeclared-import:** Parses `package.json` deps, lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), and `requirements.txt` / `pyproject.toml`. Answers "Is this import declared?" with zero network calls. Registry cross-reference is explicitly out of scope.

**insecure-defaults:** Pattern-match only — no network lookups, no external validation.

**excessive-comment-ratio:** Configurable threshold via `.aiqt.yml`. Default 0.5 (50% comment lines triggers warning).

All detectors are implemented in TypeScript. No YAML rule format in v0.1.

---

## Configuration (.aiqt.yml)

Minimal schema, validated with Zod at startup. Example:

```yaml
ignore:
  - "node_modules/**"
  - "dist/**"
  - "**/*.d.ts"

rules:
  excessive-comment-ratio:
    threshold: 0.5
  undeclared-import:
    severity: error
  insecure-defaults:
    severity: error
```

Config is optional — aiqt runs with safe defaults if no `.aiqt.yml` is present (`--no-config` skips loading entirely).

---

## Output Formats

| Format | Flag | Use Case |
|--------|------|----------|
| text | `--format text` | **Default.** Stylish terminal output, human-readable |
| json | `--format json` | Programmatic consumption, CI pipelines |
| github | `--format github` | `::error` annotations + `GITHUB_STEP_SUMMARY` |
| sarif | `--format sarif` | Optional SARIF 2.1.0, GitHub Security tab upload |
| html | `--format html` | Single-file HTML report |

SARIF is optional, not the primary format. Hand-rolled ~80 LOC serializer, `@types/sarif` for types only.

VS Code problem matcher pattern will be included in `package.json` for terminal integration.

---

## Error Handling

The engine handles the following error conditions explicitly:

- **EACCES** — Permission denied on file/directory: log warning, skip, continue
- **ELOOP** — Symlink loop: log warning, skip, continue
- **Detector throw** — Isolated per-detector: log error with detector id + file, continue with remaining detectors
- **Detector timeout** — Per-detector timeout enforced; exceeded detectors are skipped with a warning
- **EPIPE** — Piped output closed early (e.g. `aiqt scan | head`): exit cleanly, no stack trace
- **Git errors** — `--diff` ref not found or not a git repo: clear error message, exit 1

---

## Language Support (v0.1)

| Language | Support | How |
|----------|---------|-----|
| JavaScript | Built-in | @ast-grep/napi |
| TypeScript | Built-in | @ast-grep/napi |
| TSX | Built-in | @ast-grep/napi |
| Python | Included | `@ast-grep/lang-python` + `registerDynamicLanguage()` |

Language is auto-detected from file extension. Tier 2 languages (Go, Java, Rust) and community languages are deferred to later phases.

---

## What is NOT in v0.1

The following are explicitly deferred:

- **Monorepo package structure** (`@aiqt/cli`, `@aiqt/core`, etc.)
- **YAML rule format** — detectors are TypeScript-only
- **PR Gate GitHub Action** — Phase 2
- **Test Quality Evaluator** — Phase 3
- **Deferred detectors:** hallucinated-api-call, copy-paste-duplication, tautological-test, over-abstraction, buzzword-comments
- **Auto-fix / code rewriting**
- **`aiqt init`, `aiqt rules`, `aiqt explain` commands**
- **Scoring weights / quality score**
- **Online registry verification** (npm/PyPI cross-reference)
- **poetry.lock, uv.lock, Pipfile.lock** parsing
- **Tier 2+ language support** (Go, Java, Rust, etc.)

---

## Phased Roadmap

### Phase 1: Core Scanner CLI — v0.1 (current)

7 detectors, single package, JS/TS/TSX/Python, text-default output, `.aiqt.yml` config, `aiqt scan` + `aiqt check` commands. `--diff`, `--stdin-files`, `--max-findings`, `--verbose`, `--format html` included per CEO review.

### Phase 2: PR Gate GitHub Action

- Wraps core scanner
- Diff-only analysis for speed target <60s
- Inline PR comments + summary comment
- Actions on failure: comment-only (default), request-changes, label, auto-close (opt-in)
- Configuration extends `.aiqt.yml` with `pr-gate:` section

### Phase 3: Test Quality Evaluator

8 test-specific detectors including tautological-test, over-mocking (already in v0.1), missing-error-path-test, redundant-test, no-boundary-test, snapshot-only-test, implementation-coupled-test.

Optional StrykerJS/Cosmic Ray mutation testing integration.

Meaningful Coverage Score (0-100):
```
Score = weighted_average(
  assertion_quality   * 0.30,
  mutation_score      * 0.25,
  error_path_coverage * 0.20,
  boundary_coverage   * 0.15,
  independence_score  * 0.10,
)

80-100: "Strong"    60-79: "Moderate"    40-59: "Weak"    0-39: "Cosmetic"
```

---

## Positioning

> **aiqt** — the open-source linter for the AI coding era. Deterministic, free, offline. Not an AI detector. Not an LLM-based reviewer. The quality tool SonarQube and ESLint weren't designed to be.

## What This Is NOT

- Not an AI authorship detector
- Not an LLM-based reviewer (deterministic, reproducible, free)
- Not a replacement for SonarQube/ESLint (complements them)
- Not a code generation tool

---

## Sources

- [Anti-Slop GitHub](https://github.com/peakoss/anti-slop)
- [AI-SLOP-Detector GitHub](https://github.com/flamehaven01/AI-SLOP-Detector)
- [SpecDetect4AI (arxiv 2509.20491)](https://arxiv.org/abs/2509.20491)
- [Slopsquatting (USENIX Security 2025)](https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks)
- [CodeRabbit AI vs Human Code](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [ast-grep](https://ast-grep.github.io/)
- [@ast-grep/napi](https://www.npmjs.com/package/@ast-grep/napi)
- [GitHub SARIF Integration](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github)
- [StrykerJS](https://stryker-mutator.io/)
- [SonarQube AI Code Detection](https://docs.sonarsource.com/sonarqube-server/2025.2/ai-capabilities/autodetect-ai-code)
- [Qodo 2.0](https://www.qodo.ai/blog/introducing-qodo-2-0-agentic-code-review/)
- [Semgrep Multimodal](https://www.helpnetsecurity.com/2026/03/20/semgrep-multimodal-code-security/)
