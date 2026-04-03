#!/usr/bin/env bash
# vibecop benchmark — finding density comparison across clean and vibe-coded projects
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}vibecop benchmark — finding density comparison${RESET}"
echo -e "================================================"
echo ""

# ---------------------------------------------------------------------------
# run_scan <display-name> <path>
#   Runs vibecop on <path>, prints a single formatted result line.
# ---------------------------------------------------------------------------
run_scan() {
  local name="$1"
  local path="$2"

  if [ ! -d "$path" ]; then
    printf "%-34s  %-8s  %-8s  %s\n" "$name" "N/A" "N/A" "N/A (path not found)"
    return
  fi

  # Run the scanner; tolerate non-zero exit (vibecop exits 1 when findings exist)
  local raw
  raw=$(bun run "$PROJECT_ROOT/src/cli.ts" scan "$path" --format json --no-config --max-findings 500 2>/dev/null || true)

  # Extract total findings from JSON summary
  local findings
  findings=$(echo "$raw" | bun -e "
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const j = JSON.parse(d);
        process.stdout.write(String(j.summary?.total ?? j.findings?.length ?? 0));
      } catch { process.stdout.write('0'); }
    });
  " 2>/dev/null || echo "0")

  # Count LOC (TypeScript and JavaScript files only)
  local loc
  loc=$(find "$path" \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \) \
        ! -path '*/node_modules/*' ! -path '*/.git/*' \
        -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
  loc="${loc:-0}"

  # Compute density (findings per 1 000 LOC)
  local density
  if [ "$loc" -gt 0 ]; then
    density=$(echo "scale=1; $findings * 1000 / $loc" | bc 2>/dev/null || echo "?")
  else
    density="N/A"
  fi

  # Colour-code the density column
  local colour="$RESET"
  if [[ "$density" =~ ^[0-9] ]]; then
    local d_int
    d_int=$(echo "$density" | cut -d. -f1)
    if   [ "$d_int" -ge 40 ]; then colour="$RED"
    elif [ "$d_int" -ge 20 ]; then colour="$YELLOW"
    else colour="$GREEN"
    fi
  fi

  printf "%-34s  %8s  %8s  ${colour}%s/kLOC${RESET}\n" \
    "$name" "$findings findings" "$loc LOC" "$density"
}

# ---------------------------------------------------------------------------
# Print header
# ---------------------------------------------------------------------------
echo -e "${CYAN}Target                              Findings    LOC       Density${RESET}"
echo    "------                              --------    ---       -------"
echo ""
echo -e "${BOLD}-- Clean baseline --${RESET}"

run_scan "vibecop/src (self)" "$PROJECT_ROOT/src"
run_scan "clean-project" "$PROJECT_ROOT/test/fixtures/benchmark/clean-project"

echo ""
echo -e "${BOLD}-- Vibe-coded fixtures --${RESET}"

run_scan "vibe-coded-1 (any/eval/console)" "$PROJECT_ROOT/test/fixtures/benchmark/vibe-coded-1"
run_scan "vibe-coded-2 (LLM/agent issues)" "$PROJECT_ROOT/test/fixtures/benchmark/vibe-coded-2"

echo ""
echo -e "${BOLD}Interpretation:${RESET}"
echo -e "  ${GREEN}< 20/kLOC${RESET}  — well-maintained code"
echo -e "  ${YELLOW}20–39/kLOC${RESET} — moderate issues, some vibe patterns"
echo -e "  ${RED}>= 40/kLOC${RESET} — high density, likely AI-assisted with poor review"
echo ""
echo "Done."
