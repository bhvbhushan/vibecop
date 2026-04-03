import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects insecure default patterns:
 * - rejectUnauthorized: false — disabling TLS verification
 * - eval(...) — eval usage
 * - new Function(...) — dynamic code execution
 * - Hardcoded credentials (password/secret/key/token = "non-empty string")
 * - crypto.createCipheriv('des', ...) — weak cipher
 * - Python: verify=False in requests, shell=True in subprocess
 */

/** Test file detection pattern */
const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__|__test__|spec|__spec__|__mocks__|fixtures|__fixtures__)[\\/]|\.(?:test|spec|e2e)\.[^.]+$)/i;

/** Credential-related variable name patterns */
const CREDENTIAL_NAME_PATTERN =
  /^(?:.*_)?(?:password|passwd|secret|api_key|apikey|api_secret|token|auth_token|access_token|private_key)(?:_.*)?$/i;

/** Weak cipher algorithms */
const WEAK_CIPHERS = new Set(["des", "des-ede", "des-ede3", "rc4", "rc2", "md5"]);

/** Values that look like URL paths, error messages, or enum names — not credentials */
function looksLikeNonCredential(value: string): boolean {
  // URL paths: "/auth/refresh-token", "/api/token"
  if (value.startsWith("/")) return true;
  // Human-readable sentences (error messages)
  if (/\s{2,}/.test(value) || /[.!?]$/.test(value) || value.split(" ").length > 3) return true;
  // Enum/constant values: "TOKEN_EXPIRED", "REFRESH_TOKEN"
  if (/^[A-Z][A-Z_]+$/.test(value)) return true;
  // Environment variable references
  if (value.startsWith("process.env.") || value.startsWith("${")) return true;
  return false;
}

function detectJavaScriptInsecureDefaults(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // 1. rejectUnauthorized: false
  detectRejectUnauthorized(root, ctx, findings);

  // 2. eval() usage
  detectEvalUsage(root, ctx, findings);

  // 3. new Function() usage
  detectNewFunction(root, ctx, findings);

  // 4. Hardcoded credentials (skip in test files)
  if (!TEST_FILE_RE.test(ctx.file.path)) {
    detectHardcodedCredentialsJS(root, ctx, findings);
  }

  // 5. Weak ciphers
  detectWeakCiphers(root, ctx, findings);

  return findings;
}

function detectRejectUnauthorized(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const pairs = root.findAll({ rule: { kind: "pair" } });
  for (const pair of pairs) {
    const children = pair.children();
    const key = children.find(
      (ch) => ch.kind() === "property_identifier" || ch.kind() === "string",
    );
    const value = children.find((ch) => ch.kind() === "false");

    if (key && value && key.text().replace(/["']/g, "") === "rejectUnauthorized") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        pair,
        "TLS certificate verification is disabled (rejectUnauthorized: false)",
        "error",
        "Remove rejectUnauthorized: false to enable TLS certificate verification",
      ));
    }
  }
}

function detectEvalUsage(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const fn = children[0];
    if (fn && fn.kind() === "identifier" && fn.text() === "eval") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        call,
        "eval() executes arbitrary code and is a security risk",
        "error",
        "Avoid eval(). Use JSON.parse() for data, or refactor to avoid dynamic code execution",
      ));
    }
  }
}

function detectNewFunction(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const newExprs = root.findAll({ rule: { kind: "new_expression" } });
  for (const newExpr of newExprs) {
    const children = newExpr.children();
    const constructorNode = children.find((ch) => ch.kind() === "identifier");
    if (constructorNode && constructorNode.text() === "Function") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        newExpr,
        "new Function() creates functions from strings and is a security risk",
        "error",
        "Avoid new Function(). Refactor to use static function definitions",
      ));
    }
  }
}

function detectHardcodedCredentialsJS(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  // Check variable declarations: const password = "secret"
  const declarators = root.findAll({ rule: { kind: "variable_declarator" } });
  for (const decl of declarators) {
    checkCredentialAssignment(decl, ctx, findings);
  }

  // Check assignment expressions: password = "secret"
  const assignments = root.findAll({ rule: { kind: "assignment_expression" } });
  for (const assign of assignments) {
    checkCredentialAssignment(assign, ctx, findings);
  }

  // Check object properties: { password: "secret" }
  const pairs = root.findAll({ rule: { kind: "pair" } });
  for (const pair of pairs) {
    const children = pair.children();
    const key = children.find(
      (ch) => ch.kind() === "property_identifier" || ch.kind() === "string",
    );
    const value = children.find((ch) => ch.kind() === "string");

    if (!key || !value) continue;

    const keyName = key.text().replace(/["']/g, "");
    if (!CREDENTIAL_NAME_PATTERN.test(keyName)) continue;

    // Check that the string is non-empty and looks like a real credential
    const strContent = value.text().slice(1, -1);
    if (strContent.length === 0) continue;
    if (looksLikeNonCredential(strContent)) continue;

    findings.push(makeFinding(
      "insecure-defaults",
      ctx,
      pair,
      `Hardcoded credential detected in property '${keyName}'`,
      "error",
      "Use environment variables or a secrets manager instead of hardcoding credentials",
    ));
  }
}

function checkCredentialAssignment(
  node: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const children = node.children();
  const nameNode = children.find((ch) => ch.kind() === "identifier");
  const valueNode = children.find((ch) => ch.kind() === "string");

  if (!nameNode || !valueNode) return;

  const varName = nameNode.text();
  if (!CREDENTIAL_NAME_PATTERN.test(varName)) return;

  // Check that the string is non-empty and looks like a real credential
  const strContent = valueNode.text().slice(1, -1);
  if (strContent.length === 0) return;
  if (looksLikeNonCredential(strContent)) return;

  findings.push(makeFinding(
    "insecure-defaults",
    ctx,
    node,
    `Hardcoded credential detected in variable '${varName}'`,
    "error",
    "Use environment variables or a secrets manager instead of hardcoding credentials",
  ));
}

function detectWeakCiphers(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const fn = children[0];
    if (!fn || fn.kind() !== "member_expression") continue;
    if (!fn.text().endsWith("createCipheriv") && !fn.text().endsWith("createCipher")) {
      continue;
    }

    // Get the first argument (cipher algorithm)
    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args
      .children()
      .filter((ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",");
    if (argNodes.length === 0) continue;

    const firstArg = argNodes[0];
    if (firstArg.kind() === "string") {
      const cipher = firstArg.text().slice(1, -1).toLowerCase();
      if (WEAK_CIPHERS.has(cipher)) {
        findings.push(makeFinding(
          "insecure-defaults",
          ctx,
          call,
          `Weak cipher algorithm '${cipher}' detected`,
          "error",
          "Use a strong cipher algorithm like 'aes-256-gcm' instead",
        ));
      }
    }
  }
}

function detectPythonInsecureDefaults(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();

  // 1. verify=False in requests calls
  detectPythonVerifyFalse(root, ctx, findings);

  // 2. shell=True in subprocess calls
  detectPythonShellTrue(root, ctx, findings);

  // 3. eval() usage
  detectPythonEval(root, ctx, findings);

  // 4. Hardcoded credentials (skip in test files)
  if (!TEST_FILE_RE.test(ctx.file.path)) {
    detectPythonHardcodedCredentials(root, ctx, findings);
  }

  return findings;
}

function detectPythonVerifyFalse(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const kwargs = root.findAll({ rule: { kind: "keyword_argument" } });
  for (const kwarg of kwargs) {
    const children = kwarg.children();
    const key = children.find((ch) => ch.kind() === "identifier");
    const value = children.find((ch) => ch.kind() === "false");

    if (key && value && key.text() === "verify") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        kwarg,
        "TLS certificate verification is disabled (verify=False)",
        "error",
        "Remove verify=False to enable TLS certificate verification",
      ));
    }
  }
}

function detectPythonShellTrue(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const kwargs = root.findAll({ rule: { kind: "keyword_argument" } });
  for (const kwarg of kwargs) {
    const children = kwarg.children();
    const key = children.find((ch) => ch.kind() === "identifier");
    const value = children.find((ch) => ch.kind() === "true");

    if (key && value && key.text() === "shell") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        kwarg,
        "shell=True in subprocess call allows shell injection attacks",
        "error",
        "Use shell=False (the default) and pass arguments as a list",
      ));
    }
  }
}

function detectPythonEval(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const calls = root.findAll({ rule: { kind: "call" } });
  for (const call of calls) {
    const children = call.children();
    const fn = children[0];
    if (fn && fn.kind() === "identifier" && fn.text() === "eval") {
      findings.push(makeFinding(
        "insecure-defaults",
        ctx,
        call,
        "eval() executes arbitrary code and is a security risk",
        "error",
        "Avoid eval(). Use ast.literal_eval() for safe expression evaluation",
      ));
    }
  }
}

function detectPythonHardcodedCredentials(
  root: ReturnType<import("@ast-grep/napi").SgRoot["root"]>,
  ctx: DetectionContext,
  findings: Finding[],
): void {
  const assignments = root.findAll({ rule: { kind: "assignment" } });
  for (const assign of assignments) {
    const children = assign.children();
    const nameNode = children.find((ch) => ch.kind() === "identifier");
    const valueNode = children.find((ch) => ch.kind() === "string");

    if (!nameNode || !valueNode) continue;

    const varName = nameNode.text();
    if (!CREDENTIAL_NAME_PATTERN.test(varName)) continue;

    // Check that the string is non-empty (remove quotes and check)
    const rawText = valueNode.text();
    let strContent: string;
    if (rawText.startsWith("'''") || rawText.startsWith('"""')) {
      strContent = rawText.slice(3, -3);
    } else if (rawText.startsWith("f'") || rawText.startsWith('f"')) {
      strContent = rawText.slice(2, -1);
    } else {
      strContent = rawText.slice(1, -1);
    }

    if (strContent.length === 0) continue;

    findings.push(makeFinding(
      "insecure-defaults",
      ctx,
      assign,
      `Hardcoded credential detected in variable '${varName}'`,
      "error",
      "Use environment variables or a secrets manager instead of hardcoding credentials",
    ));
  }
}

export const insecureDefaults: Detector = {
  id: "insecure-defaults",
  meta: {
    name: "Insecure Defaults",
    description:
      "Detects insecure default patterns including disabled TLS, eval usage, hardcoded credentials, and weak ciphers",
    severity: "error",
    category: "security",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    if (ctx.file.language === "python") {
      return detectPythonInsecureDefaults(ctx);
    }
    return detectJavaScriptInsecureDefaults(ctx);
  },
};
