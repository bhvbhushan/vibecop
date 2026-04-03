# vibecop Benchmarks

**Date:** 2026-04-03
**vibecop version:** see package.json
**Detectors active:** 28 (22 original + 6 LLM/agent safety detectors)

---

## Overview

This document presents finding-density measurements comparing clean, professionally maintained code against synthetic "vibe-coded" fixtures designed to exhibit the antipatterns vibecop targets.

**Finding density** is the primary metric: findings per 1,000 lines of code (findings/kLOC). It normalises for project size so small and large projects can be compared directly.

---

## Methodology

### How findings are counted

`vibecop scan <path> --format json --no-config --max-findings 500` is run on each target. The `summary.total` field from the JSON output is used as the finding count. `--no-config` ensures no per-project suppression rules affect the results.

### How LOC is counted

`wc -l` across all `.ts`, `.tsx`, `.js`, and `.mjs` files under the target directory (excluding `node_modules` and `.git`).

### Targets

| Target | Type | Description |
|--------|------|-------------|
| `vibecop/src` | Clean baseline | The vibecop source itself — a professionally maintained TypeScript project |
| `clean-project` | Clean baseline | Handwritten fixture with proper error handling, typed APIs, no antipatterns |
| `vibe-coded-1` | Vibe-coded | Typical AI mistakes: excessive `any`, `eval`, `console.log`, empty catch blocks, TODO comments |
| `vibe-coded-2` | Vibe-coded | LLM/agent integration issues: no timeout, unpinned models, no system message, dynamic `eval` of LLM output |

Fixture sources are located at `test/fixtures/benchmark/`. The script is at `scripts/benchmark.sh`.

---

## Results

Run on 2026-04-03 with vibecop's 28 built-in detectors:

| Target | Findings | LOC | Density (findings/kLOC) |
|--------|----------|-----|------------------------|
| vibecop/src (self) | 91 | 8,108 | **11.2** |
| clean-project | 0 | 157 | **0.0** |
| vibe-coded-1 (any/eval/console) | 56 | 149 | **375.8** |
| vibe-coded-2 (LLM/agent issues) | 52 | 163 | **319.0** |

### Density scale

| Range | Signal |
|-------|--------|
| < 20/kLOC | Well-maintained code |
| 20–39/kLOC | Moderate issues, some vibe patterns |
| ≥ 40/kLOC | High density — likely AI-assisted with limited review |

---

## Key Takeaways

1. **30–35x density gap.** Vibe-coded fixtures score 319–376 findings/kLOC versus 0–11 for clean baselines — a ~30–35x difference. This matches the design goal of making AI-generated antipatterns clearly distinguishable from well-maintained code.

2. **vibecop's own source is clean.** The self-scan at 11.2/kLOC puts vibecop in the "well-maintained" band. Findings are concentrated in legitimate edge cases (e.g., `any` usage inside detector internals where it's intentional).

3. **Distinct failure modes are detectable.** `vibe-coded-1` is dominated by structural issues (`excessive-any`, `debug-console-in-prod`, `empty-error-handler`, `todo-in-production`, `dynamic-code-exec`). `vibe-coded-2` layers LLM-specific patterns on top (`llm-call-no-timeout`, `llm-unpinned-model`, `llm-no-system-message`, `llm-temperature-not-set`, `unsafe-shell-exec`). The detectors fire on the right categories.

4. **Reproducible.** All targets are committed to the repository. Anyone can re-run `bash scripts/benchmark.sh` and get the same result (assuming the same detector set).

---

## Reproducing

```bash
bash scripts/benchmark.sh
```

Requirements: `bun`, `bc` (both available in the dev environment).
