# VibeCop Rules: AST-Grep vs Tractor Comparison

This document compares every VibeCop detector with its Tractor XPath equivalent,
showing the dramatic reduction in complexity.

## Summary

| Metric | VibeCop (ast-grep) | Tractor (XPath) |
|--------|-------------------|-----------------|
| Rule definitions | 3,863 lines TypeScript (22 files) | ~210 lines YAML ([rules.yaml](rules.yaml)) |
| Validation / tests | 3,804 lines TypeScript (22 files) | ~56 lines YAML (inline in [rules.yaml](rules.yaml)) |
| Comments / boilerplate | (included above) | ~36 lines |
| **Total** | **7,667 lines across 44 files** | **302 lines in [1 file](rules.yaml)** |
| VibeCop detectors replaced | — | 11 of 22 (19 XPath rules in [rules.yaml](rules.yaml)) |
| Not yet portable | — | 11 detectors (2 TSX bug, 3 beyond AST scope, 6 complex/heuristic) |

Tractor's `expect-valid` / `expect-invalid` fields embed validation examples
directly in the rule definition. VibeCop requires separate `*.test.ts` files with
a full Bun test harness, AST parsing setup, and assertion boilerplate for every rule.

**The Tractor rules file (258 lines including inline validation examples)
replaces both the detector code AND the test code.**

## Rule-by-Rule Comparison

### All VibeCop Rules

| # | VibeCop Rule | Category | Det. | Tests | **Total** | Tractor | Status |
|---|-------------|----------|------|-------|-----------|---------|--------|
| 1 | `debug-console-in-prod` | quality | 88 | 157 | **245** | 13 lines | Ported |
| 2 | `double-type-assertion` | quality | 49 | 129 | **178** | 8 lines | Ported |
| 3 | `empty-error-handler` | quality | 174 | 209 | **383** | 18 lines | Ported |
| 4 | `todo-in-production` | quality | 53 | 200 | **253** | 10 lines | Ported |
| 5 | `god-function` | quality | 294 | 196 | **490** | 21 lines | Ported* |
| 6 | `god-component` | quality | 128 | 196 | **324** | — | Blocked: TSX parsing ([#67](https://github.com/boukeversteegh/tractor/issues/67)) |
| 7 | `n-plus-one-query` | correctness | 291 | 175 | **466** | 15 lines | Ported |
| 8 | `unbounded-query` | quality | 146 | 91 | **237** | — | Needs: negative check on chained calls |
| 9 | `dead-code-path` | quality | 122 | 177 | **299** | 5 lines | Ported |
| 10 | `excessive-any` | quality | 89 | 163 | **252** | — | Needs: file-level counting (may work) |
| 11 | `excessive-comment-ratio` | quality | 133 | 186 | **319** | — | Needs: comment-to-code ratio heuristic |
| 12 | `over-defensive-coding` | quality | 241 | 152 | **393** | — | Needs: complex pair-check patterns |
| 13 | `sql-injection` | security | 195 | 132 | **327** | 18 lines | Ported |
| 14 | `dangerous-inner-html` | security | 49 | 85 | **134** | — | Blocked: TSX parsing ([#67](https://github.com/boukeversteegh/tractor/issues/67)) |
| 15 | `token-in-localstorage` | security | 66 | 131 | **197** | 15 lines | Ported |
| 16 | `insecure-defaults` | security | 434 | 266 | **699** | 14 lines | Partial (eval+TLS) |
| 17 | `placeholder-in-production` | security | 71 | 135 | **206** | — | Doable: many `contains()` patterns |
| 18 | `unchecked-db-result` | correctness | 154 | 157 | **311** | — | Needs: parent context / ancestor axis |
| 19 | `mixed-concerns` | correctness | 104 | 129 | **233** | — | Beyond AST: file-level import analysis |
| 20 | `undeclared-import` | correctness | 563 | 284 | **847** | — | Beyond AST: needs package.json |
| 21 | `trivial-assertion` | testing | 261 | 242 | **503** | 8 lines | Ported |
| 22 | `over-mocking` | testing | 159 | 212 | **371** | — | Beyond AST: mock vs assertion counting |
| | **Totals** | | **3,864** | **3,804** | **7,668** | **302** | **11 of 22 ported** |

\* Requires `--meta` flag for line-count detection via `substring-before(@end, ':')`.

**Ported subset: 4,040 lines of TypeScript → 302 lines of YAML (13x reduction)**

## What This Proves

### The core insight

VibeCop's detectors are 90% boilerplate: finding AST nodes, filtering by kind,
extracting text, comparing values, building Finding objects. The actual **pattern**
each rule detects is expressible in 1-3 lines of XPath.

### By the numbers

```
VibeCop (ast-grep):
  Detectors:    3,863 lines TypeScript
  Tests:        3,804 lines TypeScript
  ────────────────────────────────────
  Total:        7,667 lines across 44 files

Tractor (XPath):
  Rules + tests: 302 lines YAML (1 file)
  ────────────────────────────────────
  Coverage:      11 of 22 detectors (19 XPath rules)

Ported subset only:
  VibeCop:  4,040 lines (detectors + tests for the 11 ported detectors)
  Tractor:    302 lines (rules + inline tests + comments)
  Ratio:      13x reduction
```

### What blocks the remaining 11 detectors

1. **TSX/JSX parsing** (2 detectors) — Tractor bug ([tractor#67](https://github.com/boukeversteegh/tractor/issues/67)), fix would unlock them
2. **Cross-file/project context** (3 detectors) — fundamentally beyond pure AST scope (`undeclared-import`, `mixed-concerns`, `over-mocking`)
3. **Complex heuristics** (6 detectors) — file-level counting, regex patterns, pair-check logic; some may be expressible with more XPath work

Once TSX parsing is fixed, Tractor would cover **13 of 22 detectors** (~60%).
The remaining 9 need either cross-file analysis (3) or complex heuristics (6)
that may or may not be expressible in XPath.
