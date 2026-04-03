import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

function detect(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (ctx.file.language !== "tsx") return findings;
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;

  const root = ctx.root.root();

  // Find jsx_attribute with name "dangerouslySetInnerHTML"
  const jsxAttrs = root.findAll({ rule: { kind: "jsx_attribute" } });
  for (const attr of jsxAttrs) {
    const children = attr.children();
    const name = children.find(ch =>
      ch.kind() === "property_identifier" || ch.kind() === "identifier"
    );
    if (!name) continue;
    if (name.text() !== "dangerouslySetInnerHTML") continue;

    findings.push(makeFinding(
      "dangerous-inner-html",
      ctx,
      attr,
      "dangerouslySetInnerHTML can lead to XSS attacks if the content is not sanitized",
      "warning",
      "Use a sanitization library like DOMPurify: dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(content)}}",
    ));
  }

  return findings;
}

export const dangerousInnerHtml: Detector = {
  id: "dangerous-inner-html",
  meta: {
    name: "Dangerous innerHTML",
    description: "Detects use of dangerouslySetInnerHTML in React components which can lead to XSS",
    severity: "warning",
    category: "security",
    languages: ["tsx"],
  },
  detect,
};
