# vibecop Benchmarks

**Date:** 2026-04-03
**vibecop version:** 0.2.0
**Detectors active:** 28

---

## Overview

Finding density comparison between established, professionally maintained open-source projects and vibe-coded (AI-generated/assisted) projects. All numbers are real — run `vibecop scan` on any repo to reproduce.

**Finding density** = findings per 1,000 lines of code (findings/kLOC). Normalises for project size.

---

## Methodology

### How findings are counted

`vibecop scan <path> --format json --no-config --max-findings 2000` on each target. `summary.total` from JSON output. `--no-config` ensures no per-project suppression.

### How LOC is counted

`wc -l` across all `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py` files (excluding `node_modules`, `dist`, `build`).

---

## Results

### Established projects (professionally maintained)

| Project | Stars | Files | LOC | Findings | Density |
|---------|:-----:|:-----:|----:|:--------:|--------:|
| [fastify](https://github.com/fastify/fastify) | 65K | 275 | 74,428 | 124 | 1.7/kLOC |
| [date-fns](https://github.com/date-fns/date-fns) | 35K | 1,543 | 99,859 | 308 | 3.1/kLOC |
| [TanStack/query](https://github.com/TanStack/query) | 43K | 997 | 148,492 | 652 | 4.4/kLOC |
| [express](https://github.com/expressjs/express) | 66K | 141 | 21,346 | 123 | 5.8/kLOC |
| [zod](https://github.com/colinhacks/zod) | 35K | 356 | 70,886 | 964 | 13.6/kLOC |

**Median: 4.4/kLOC | Average: 5.7/kLOC**

### Vibe-coded projects (AI-generated/assisted)

| Project | Stars | Files | LOC | Findings | Density |
|---------|:-----:|:-----:|----:|:--------:|--------:|
| [dyad](https://github.com/dyad-sh/dyad) | 20K | 956 | 147,284 | 1,179 | 8.0/kLOC |
| [code-review-graph](https://github.com/tirth8205/code-review-graph) | 3.9K | 95 | 27,119 | 361 | 13.3/kLOC |
| [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | 19.2K | 392 | 71,639 | 977 | 13.6/kLOC |
| [context7](https://github.com/upstash/context7) | 51.3K | 71 | 9,201 | 129 | 14.0/kLOC |
| [vibe-check-mcp](https://github.com/PV-Bhat/vibe-check-mcp-server) | 480 | 55 | 5,964 | 119 | 20.0/kLOC |
| [magic-mcp](https://github.com/21st-dev/magic-mcp) | 4.6K | 14 | 1,096 | 28 | 25.5/kLOC |
| [browser-tools-mcp](https://github.com/AgentDeskAI/browser-tools-mcp) | 7.2K | 12 | 8,346 | 414 | 49.6/kLOC |

**Median: 14.0/kLOC | Average: 20.6/kLOC**

### Comparison

| Metric | Established | Vibe-coded | Ratio |
|--------|:-----------:|:----------:|:-----:|
| Median density | 4.4/kLOC | 14.0/kLOC | **3.2x** |
| Average density | 5.7/kLOC | 20.6/kLOC | **3.6x** |

---

## Notes on established repo findings

Some established repos show higher density for valid reasons:

- **zod** (13.6/kLOC): 634 of 964 findings are `excessive-any`. Zod deliberately uses `any` for TypeScript type gymnastics — this is intentional, not a code smell.
- **date-fns** (3.1/kLOC): 218 of 308 findings are `excessive-comment-ratio`. date-fns has extensive JSDoc documentation — by design, not an AI pattern.
- **express** (5.8/kLOC): 73 of 123 findings are `placeholder-in-production`. Express uses example domains in comments.

vibecop detects patterns, not intent. Use `.vibecop.yml` to tune or disable detectors for your codebase.

---

## v0.2 new detector impact

The 6 new LLM/agent safety detectors found **157 additional issues** across the vibe-coded repos that the v0.1 detectors missed entirely:

| Detector | Findings | Example repo |
|----------|:--------:|--------------|
| unsafe-shell-exec | 63 | dyad (47), context7 (6), code-review-graph (5) |
| llm-unpinned-model | 53 | bolt.diy (32), dyad (12), vibe-check-mcp (6) |
| llm-no-system-message | 39 | dyad (31), bolt.diy (7), vibe-check-mcp (1) |
| llm-call-no-timeout | 2 | vibe-check-mcp (2) |

Zero v0.2 detector findings on the 5 established repos (they don't use LLM APIs or dynamic shell execution).

---

## Reproducing

```bash
# Fixture benchmark (committed to repo)
bash scripts/benchmark.sh

# Full open-source benchmark (clones repos)
git clone --depth 1 https://github.com/fastify/fastify /tmp/fastify
vibecop scan /tmp/fastify --format json --no-config --max-findings 2000
```
