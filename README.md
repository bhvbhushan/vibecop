# vibecop

[![license](https://img.shields.io/npm/l/vibecop)](https://github.com/bhvbhushan/vibecop/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![CI](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml/badge.svg)](https://github.com/bhvbhushan/vibecop/actions/workflows/ci.yml)
[![Playground](https://img.shields.io/badge/Try-Playground-orange)](https://vibecop-pg.bhvbhushan7.com/)

AI code quality toolkit — deterministic linter for the AI coding era. 35 detectors catch the bugs AI agents introduce: god functions, N+1 queries, unsafe shell exec, unpinned LLM models, and more. Runs automatically inside Claude Code, Cursor, Codex, Aider, and 7 other AI tools. Also available as an MCP server.

Built on [ast-grep](https://ast-grep.github.io/) for fast, tree-sitter-based AST analysis. No LLM required — every finding is deterministic and reproducible.

**[Documentation](https://bhvbhushan.github.io/vibecop/)** | **[Playground](https://vibecop-pg.bhvbhushan7.com/)**

## Install

```bash
npm install -g vibecop    # or: bun add -g vibecop
```

## Quick Start

```bash
vibecop scan .                         # Scan current directory
vibecop scan src/ --format json        # JSON output
vibecop scan . --diff HEAD             # Only changed files
vibecop init                           # Auto-setup agent integration
vibecop serve                          # Start MCP server
```

## Agent Integration

vibecop runs inside your AI coding agent. Every edit triggers a scan — the agent reads findings and self-corrects.

```bash
npx vibecop init    # Auto-detects tools, generates configs
```

| Tool | Integration |
|------|-------------|
| **Claude Code** | PostToolUse hook |
| **Cursor** | afterFileEdit hook + rules |
| **Codex CLI** | PostToolUse hook |
| **Aider** | Native `--lint-cmd` |
| **GitHub Copilot** | Custom instructions |
| **Windsurf** | Rules file |
| **Cline/Roo Code** | `.clinerules` |
| **Continue.dev / Amazon Q / Zed** | MCP server (`vibecop serve`) |

```
Agent writes code → vibecop hook fires → Findings? Agent fixes → Clean? Continue.
```

## MCP Server

```json
{
  "mcpServers": {
    "vibecop": {
      "command": "npx",
      "args": ["vibecop", "serve"]
    }
  }
}
```

Three tools: `vibecop_scan`, `vibecop_check`, `vibecop_explain`.

## Benchmarks

All numbers are real — run `vibecop scan` on any repo to reproduce.

**Established projects:**

| Project | Density |
|---------|--------:|
| [fastify](https://github.com/fastify/fastify) (65K stars) | 1.7/kLOC |
| [date-fns](https://github.com/date-fns/date-fns) (35K stars) | 3.1/kLOC |
| [TanStack/query](https://github.com/TanStack/query) (43K stars) | 4.4/kLOC |
| [express](https://github.com/expressjs/express) (66K stars) | 5.8/kLOC |

**Vibe-coded projects:**

| Project | Density |
|---------|--------:|
| [dyad](https://github.com/dyad-sh/dyad) (20K stars) | 8.0/kLOC |
| [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) (19K stars) | 13.6/kLOC |
| [context7](https://github.com/upstash/context7) (51K stars) | 14.0/kLOC |
| [browser-tools-mcp](https://github.com/AgentDeskAI/browser-tools-mcp) (7K stars) | 49.6/kLOC |

**Median: established 4.4/kLOC vs vibe-coded 14.0/kLOC (3.2x higher).**

## GitHub Action

```yaml
- uses: bhvbhushan/vibecop@main
  with:
    on-failure: comment-only
    severity-threshold: warning
```

## Detectors (35)

4 categories: **Quality** (16), **Security** (7), **Correctness** (4), **Testing** (8).

Catches: god functions, N+1 queries, unsafe shell exec, SQL injection, hardcoded secrets, trivial assertions, empty tests, unpinned LLM models, hallucinated packages, and more.

[Full detector reference →](https://bhvbhushan.github.io/vibecop/detectors/overview/)

## Roadmap

- [x] **Phase 1**: Core scanner — 7 detectors, 5 output formats
- [x] **Phase 2**: PR Gate GitHub Action, 15 new detectors
- [x] **Phase 2.5**: Agent integration (7 tools), 6 LLM/agent detectors, `vibecop init`
- [x] **Phase 3**: Test quality detectors, custom YAML rules (28 → 35)
- [x] **Phase 3.5**: MCP server with scan/check/explain tools
- [ ] **Phase 4**: Context optimization (Read tool interception, AST skeleton caching)
- [ ] **Phase 5**: VS Code extension, cross-file analysis

## Links

- **[Documentation](https://bhvbhushan.github.io/vibecop/)**
- **[Playground](https://vibecop-pg.bhvbhushan7.com/)**
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE) (MIT)
