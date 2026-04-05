import type { Detector, DetectionContext, Finding } from "../types.js";
import { isTestFile, makeLineFinding } from "./utils.js";

const JS_SLEEP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsetTimeout\s*\(/, label: "setTimeout(" },
  { re: /\bsetInterval\s*\(/, label: "setInterval(" },
  { re: /\bawait\s+sleep\s*\(/, label: "await sleep(" },
  { re: /\bawait\s+delay\s*\(/, label: "await delay(" },
  {
    re: /\bawait\s+new\s+Promise\b.*\bsetTimeout\b/,
    label: "await new Promise + setTimeout",
  },
];

const PY_SLEEP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\btime\.sleep\s*\(/, label: "time.sleep(" },
  { re: /\basyncio\.sleep\s*\(/, label: "asyncio.sleep(" },
];

function detect(ctx: DetectionContext): Finding[] {
  if (!isTestFile(ctx.file.path)) return [];

  const patterns =
    ctx.file.language === "python" ? PY_SLEEP_PATTERNS : JS_SLEEP_PATTERNS;
  const lines = ctx.source.split("\n");
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    for (const { re, label } of patterns) {
      const match = line.match(re);
      if (match) {
        findings.push(
          makeLineFinding(
            "sleepy-test",
            ctx,
            i + 1,
            (match.index ?? 0) + 1,
            `Test uses ${label} which causes flaky results and slow CI.`,
            "warning",
            "Use fake timers (jest.useFakeTimers(), vi.useFakeTimers()) or async utilities (waitFor, flushPromises) instead.",
          ),
        );
        break; // one finding per line
      }
    }
  }

  return findings;
}

export const sleepyTest: Detector = {
  id: "sleepy-test",
  meta: {
    name: "Sleepy Test",
    description:
      "Detects sleep/delay calls in tests that cause flaky CI and slow suites",
    severity: "warning",
    category: "testing",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect,
};
