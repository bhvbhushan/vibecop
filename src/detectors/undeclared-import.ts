import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Detector, DetectionContext, Finding } from "../types.js";
import { makeFinding } from "./utils.js";

/**
 * Detects imports that aren't declared in the project's manifest files.
 *
 * JS/TS: Checks import declarations and require() calls against package.json deps.
 * Python: Checks import/from-import statements against requirements.txt / pyproject.toml deps.
 *
 * Skips:
 * - Relative imports (./foo, ../bar)
 * - Node builtins (fs, path, etc.) and node: protocol
 * - TypeScript path aliases (@/, ~/)
 * - Already-declared packages in dependencies/devDependencies
 * - Files when no manifest is found (can't know what's declared)
 */

const NODE_BUILTINS = new Set([
  "fs", "path", "crypto", "http", "https", "os", "util", "url",
  "stream", "events", "child_process", "buffer", "assert",
  "querystring", "zlib", "net", "tls", "dns", "cluster",
  "readline", "vm", "worker_threads", "perf_hooks", "async_hooks",
  "fs/promises", "stream/promises", "timers/promises",
  "module", "console", "process", "v8", "inspector",
  "diagnostics_channel", "trace_events", "string_decoder",
  "domain", "punycode", "constants", "sys", "tty", "dgram",
  "wasi",
]);

const PYTHON_BUILTINS = new Set([
  "os", "sys", "json", "re", "math", "datetime", "collections",
  "itertools", "functools", "pathlib", "typing", "abc", "io",
  "copy", "enum", "dataclasses", "logging", "unittest", "argparse",
  "subprocess", "shutil", "glob", "tempfile", "hashlib", "base64",
  "struct", "socket", "http", "urllib", "email", "html", "xml",
  "csv", "sqlite3", "threading", "multiprocessing", "asyncio",
  "contextlib", "traceback", "warnings", "importlib", "inspect",
  "pdb", "string", "textwrap", "unicodedata", "codecs", "pprint",
  "numbers", "decimal", "fractions", "random", "statistics", "time",
  "calendar", "operator", "pickle", "shelve", "marshal", "dbm",
  "gzip", "bz2", "lzma", "zipfile", "tarfile", "configparser",
  "secrets", "hmac", "ssl", "signal", "select", "selectors",
  "ctypes", "platform", "sysconfig", "site", "builtins", "_thread",
  "__future__", "types", "weakref", "array", "queue", "heapq",
  "bisect", "graphlib", "plistlib", "pty", "fcntl", "termios",
  "mmap", "resource", "grp", "pwd", "crypt", "tty",
  // Introspection & compilation
  "uuid", "ast", "dis", "token", "tokenize", "keyword", "code",
  "codeop", "compile", "compileall", "py_compile", "zipimport",
  "pkgutil", "modulefinder", "runpy", "symtable", "tabnanny", "pyclbr",
  // Profiling & debugging
  "profile", "cProfile", "timeit", "trace",
  // File & path utilities
  "linesep", "posixpath", "ntpath", "fnmatch", "linecache",
  "filecmp", "fileinput", "stat", "posix", "nt",
  // Terminal & i18n
  "curses", "getpass", "gettext", "locale",
  // Text processing & networking
  "difflib", "ftplib", "poplib", "imaplib", "smtplib",
  "socketserver", "xmlrpc", "ipaddress", "webbrowser",
  "wsgiref", "cgi", "cgitb", "mailbox",
  // Encoding & multimedia
  "binascii", "quopri", "uu", "colorsys", "imghdr", "sndhdr",
  "ossaudiodev", "chunk", "wave", "audioop", "aifc", "sunau",
  // Miscellaneous
  "formatter", "rlcompleter",
]);

/**
 * Extract the package name from a JS/TS import specifier.
 * - `lodash` -> `lodash`
 * - `lodash/merge` -> `lodash`
 * - `@scope/pkg` -> `@scope/pkg`
 * - `@scope/pkg/sub` -> `@scope/pkg`
 */
function extractJsPackageName(specifier: string): string | null {
  if (!specifier) return null;

  // Scoped package
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }

  // Unscoped: take first segment
  const slashIdx = specifier.indexOf("/");
  return slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
}

function isRelativeImport(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..";
}

function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith("bun:")) return true;
  return NODE_BUILTINS.has(specifier);
}

function isPathAlias(specifier: string): boolean {
  return specifier.startsWith("@/") || specifier.startsWith("~/");
}

/** Cache for nearest dependency lookups, keyed by directory path */
const nearestDepsCache = new Map<string, Set<string>>();

/**
 * Walk up from a file's directory to find the nearest package.json
 * and collect its dependencies. Stops at the first package.json found.
 * Results are cached per directory to avoid repeated filesystem reads.
 */
function findNearestJsDependencies(filePath: string, scanRoot: string): Set<string> {
  let dir = dirname(filePath);

  // Check cache first
  if (nearestDepsCache.has(dir)) {
    return nearestDepsCache.get(dir)!;
  }

  const startDir = dir;
  const deps = new Set<string>();

  while (dir.length >= scanRoot.length) {
    const pkgPath = join(dir, "package.json");
    try {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.dependencies) {
          for (const dep of Object.keys(pkg.dependencies)) {
            deps.add(dep);
          }
        }
        if (pkg.devDependencies) {
          for (const dep of Object.keys(pkg.devDependencies)) {
            deps.add(dep);
          }
        }
        if (pkg.peerDependencies) {
          for (const dep of Object.keys(pkg.peerDependencies)) {
            deps.add(dep);
          }
        }
        // Found a package.json, stop walking
        break;
      }
    } catch {
      // No valid package.json here, keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  nearestDepsCache.set(startDir, deps);
  return deps;
}

/**
 * Walk up from a file's directory to find the nearest requirements.txt
 * or pyproject.toml and collect its dependencies.
 * Results are cached per directory.
 */
function findNearestPyDependencies(filePath: string, scanRoot: string): Set<string> {
  let dir = dirname(filePath);
  const cacheKey = `py:${dir}`;

  if (nearestDepsCache.has(cacheKey)) {
    return nearestDepsCache.get(cacheKey)!;
  }

  const startDir = dir;
  const deps = new Set<string>();

  while (dir.length >= scanRoot.length) {
    // Check requirements.txt
    const reqPath = join(dir, "requirements.txt");
    try {
      if (existsSync(reqPath)) {
        const raw = readFileSync(reqPath, "utf-8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
          const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
          if (match?.[1]) deps.add(match[1]);
        }
        break;
      }
    } catch {
      // skip
    }

    // Check pyproject.toml
    const tomlPath = join(dir, "pyproject.toml");
    try {
      if (existsSync(tomlPath)) {
        const raw = readFileSync(tomlPath, "utf-8");
        const lines = raw.split("\n");
        let inProjectSection = false;
        let inDepsArray = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("[")) {
            inProjectSection = trimmed === "[project]";
            inDepsArray = false;
            continue;
          }
          if (inProjectSection && trimmed.startsWith("dependencies")) {
            const m = trimmed.match(/^dependencies\s*=\s*\[/);
            if (m) {
              inDepsArray = true;
              const items = trimmed.match(/"([^"]+)"/g) ?? [];
              for (const item of items) {
                const name = item.replace(/"/g, "").match(/^([a-zA-Z0-9_-]+)/)?.[1];
                if (name) deps.add(name);
              }
              if (trimmed.includes("]")) inDepsArray = false;
              continue;
            }
          }
          if (inDepsArray) {
            if (trimmed === "]") { inDepsArray = false; continue; }
            const nameMatch = trimmed.match(/"([^"]+)"/);
            if (nameMatch?.[1]) {
              const name = nameMatch[1].match(/^([a-zA-Z0-9_-]+)/)?.[1];
              if (name) deps.add(name);
            }
          }
        }
        break;
      }
    } catch {
      // skip
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  nearestDepsCache.set(cacheKey, deps);
  return deps;
}

/** Common Python packages where the import name differs from the pip name */
const PYTHON_IMPORT_TO_PACKAGE: Record<string, string> = {
  PIL: "Pillow", cv2: "opencv-python", sklearn: "scikit-learn",
  gi: "PyGObject", yaml: "PyYAML", bs4: "beautifulsoup4",
  attr: "attrs", dateutil: "python-dateutil", dotenv: "python-dotenv",
  jose: "python-jose", jwt: "PyJWT", magic: "python-magic",
  serial: "pyserial", usb: "pyusb", wx: "wxPython",
  skimage: "scikit-image", Bio: "biopython", lxml: "lxml",
  google: "google-cloud-core", azure: "azure-core",
};

/** Common test-only packages in Python */
const PYTHON_TEST_PACKAGES = new Set([
  "pytest", "hypothesis", "unittest", "mock", "faker",
  "factory", "freezegun", "responses", "httpretty", "vcrpy",
  "tox", "nox", "coverage", "pytest_mock",
]);

/** Cache for local package directory lookups */
const localPackageCache = new Map<string, Set<string>>();

/** Cache: project root path -> local package names */
const projectRootCache = new Map<string, string>();

/**
 * Find the nearest Python project root by walking up from a directory.
 * A project root contains setup.py, pyproject.toml, or requirements.txt.
 */
function findPyProjectRoot(fileDir: string, scanRoot: string): string {
  if (projectRootCache.has(fileDir)) {
    return projectRootCache.get(fileDir)!;
  }

  let dir = fileDir;
  let result = scanRoot;
  while (dir.length >= scanRoot.length) {
    if (existsSync(join(dir, "setup.py")) ||
        existsSync(join(dir, "pyproject.toml")) ||
        existsSync(join(dir, "requirements.txt"))) {
      result = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  projectRootCache.set(fileDir, result);
  return result;
}

/**
 * Find local Python packages at a given project root.
 * Checks for directories with __init__.py and standalone .py files.
 * Results cached per project root.
 */
function findLocalPyPackages(filePath: string, scanRoot: string): Set<string> {
  const fileDir = dirname(filePath);
  const projectRoot = findPyProjectRoot(fileDir, scanRoot);

  if (localPackageCache.has(projectRoot)) {
    return localPackageCache.get(projectRoot)!;
  }

  const locals = new Set<string>();
  try {
    const entries = readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const initPath = join(projectRoot, entry.name, "__init__.py");
        if (existsSync(initPath)) {
          locals.add(entry.name);
        }
      }
      if (entry.isFile() && entry.name.endsWith(".py") && entry.name !== "setup.py") {
        locals.add(entry.name.replace(".py", ""));
      }
    }
  } catch {
    // Not readable
  }

  locals.add(basename(projectRoot));

  localPackageCache.set(projectRoot, locals);
  return locals;
}

function isPythonImportDeclared(topLevel: string, ctx: DetectionContext, scanRoot: string): boolean {
  if (PYTHON_BUILTINS.has(topLevel)) return true;
  if (ctx.project.dependencies.has(topLevel)) return true;

  // Check import-to-package mapping (e.g., PIL -> Pillow)
  const mappedName = PYTHON_IMPORT_TO_PACKAGE[topLevel];
  if (mappedName && ctx.project.dependencies.has(mappedName)) return true;

  // Check nearest manifest
  const nearestDeps = findNearestPyDependencies(ctx.file.absolutePath, scanRoot);
  if (nearestDeps.has(topLevel)) return true;
  if (mappedName && nearestDeps.has(mappedName)) return true;

  // Check if it's a local package (directory with __init__.py near the file)
  const localPackages = findLocalPyPackages(ctx.file.absolutePath, scanRoot);
  if (localPackages.has(topLevel)) return true;

  // Common test packages -- skip in test files
  const TEST_FILE_RE = /(?:[\\/](?:test|tests|__tests__)[\\/]|[\\/]test_[^/\\]+\.py$|[\\/][^/\\]+_test\.py$|[\\/]conftest\.py$)/i;
  if (PYTHON_TEST_PACKAGES.has(topLevel) && TEST_FILE_RE.test(ctx.file.path)) return true;

  return false;
}

function isDeclaredJs(packageName: string, ctx: DetectionContext): boolean {
  return ctx.project.dependencies.has(packageName) || ctx.project.devDependencies.has(packageName);
}

function getScanRoot(ctx: DetectionContext): string {
  // absolutePath = scanRoot + "/" + path (or scanRoot + path if path is empty)
  const abs = ctx.file.absolutePath;
  const rel = ctx.file.path;
  if (rel && abs.endsWith(rel)) {
    const scanRoot = abs.slice(0, abs.length - rel.length);
    // Remove trailing slash
    return scanRoot.endsWith("/") ? scanRoot.slice(0, -1) : scanRoot;
  }
  return dirname(abs);
}

function detectJavaScriptUndeclaredImports(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();
  const scanRoot = getScanRoot(ctx);

  // 1. Find import declarations: import x from 'pkg'
  const importDecls = root.findAll({ rule: { kind: "import_statement" } });
  for (const importNode of importDecls) {
    const sourceNode = importNode.children().find((ch) => ch.kind() === "string");
    if (!sourceNode) continue;

    const specifier = sourceNode.text().slice(1, -1); // Remove quotes
    if (!specifier) continue;
    if (isRelativeImport(specifier)) continue;
    // Skip Deno-style URL imports (https://, http://, jsr:, npm:)
    if (specifier.startsWith("https://") || specifier.startsWith("http://") || specifier.startsWith("jsr:") || specifier.startsWith("npm:")) continue;
    if (isNodeBuiltin(specifier)) continue;
    if (isPathAlias(specifier)) continue;

    const packageName = extractJsPackageName(specifier);
    if (!packageName) continue;
    if (isDeclaredJs(packageName, ctx)) continue;

    // Check nearest package.json in monorepo setups
    const nearestDeps = findNearestJsDependencies(ctx.file.absolutePath, scanRoot);
    if (nearestDeps.has(packageName)) continue;

    findings.push(makeFinding(
      "undeclared-import",
      ctx,
      importNode,
      `Import '${packageName}' is not declared in project dependencies`,
      "error",
      `Add '${packageName}' to your package.json dependencies`,
    ));
  }

  // 2. Find require() calls: const x = require('pkg')
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const fn = children[0];
    if (!fn || fn.kind() !== "identifier" || fn.text() !== "require") continue;

    const args = children.find((ch) => ch.kind() === "arguments");
    if (!args) continue;

    const argNodes = args.children().filter(
      (ch) => ch.kind() !== "(" && ch.kind() !== ")" && ch.kind() !== ",",
    );
    if (argNodes.length !== 1) continue;

    const arg = argNodes[0];
    if (arg.kind() !== "string") continue;

    const specifier = arg.text().slice(1, -1);
    if (!specifier) continue;
    if (isRelativeImport(specifier)) continue;
    // Skip Deno-style URL imports (https://, http://, jsr:, npm:)
    if (specifier.startsWith("https://") || specifier.startsWith("http://") || specifier.startsWith("jsr:") || specifier.startsWith("npm:")) continue;
    if (isNodeBuiltin(specifier)) continue;
    if (isPathAlias(specifier)) continue;

    const packageName = extractJsPackageName(specifier);
    if (!packageName) continue;
    if (isDeclaredJs(packageName, ctx)) continue;

    // Check nearest package.json in monorepo setups
    const nearestDeps = findNearestJsDependencies(ctx.file.absolutePath, scanRoot);
    if (nearestDeps.has(packageName)) continue;

    findings.push(makeFinding(
      "undeclared-import",
      ctx,
      call,
      `Import '${packageName}' is not declared in project dependencies`,
      "error",
      `Add '${packageName}' to your package.json dependencies`,
    ));
  }

  return findings;
}

function detectPythonUndeclaredImports(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  const root = ctx.root.root();
  const scanRoot = getScanRoot(ctx);

  // Find import_statement: `import X` or `import X.Y`
  const importStmts = root.findAll({ rule: { kind: "import_statement" } });
  for (const importNode of importStmts) {
    const children = importNode.children();
    // children: "import", dotted_name | aliased_import
    const nameNode = children.find(
      (ch) => ch.kind() === "dotted_name" || ch.kind() === "aliased_import",
    );
    if (!nameNode) continue;

    let fullName: string;
    if (nameNode.kind() === "aliased_import") {
      const dottedName = nameNode.children().find((ch) => ch.kind() === "dotted_name");
      fullName = dottedName ? dottedName.text() : nameNode.text();
    } else {
      fullName = nameNode.text();
    }

    const topLevel = fullName.split(".")[0];
    if (isPythonImportDeclared(topLevel, ctx, scanRoot)) continue;

    findings.push(makeFinding(
      "undeclared-import",
      ctx,
      importNode,
      `Import '${topLevel}' is not declared in project dependencies`,
      "error",
      `Add '${topLevel}' to your requirements.txt or pyproject.toml`,
    ));
  }

  // Find import_from_statement: `from X import Y` or `from X.Y import Z`
  const fromImports = root.findAll({ rule: { kind: "import_from_statement" } });
  for (const importNode of fromImports) {
    const text = importNode.text();
    // Skip relative imports: from . import X, from .. import X, from .module import X
    if (/^from\s+\./.test(text)) continue;

    const children = importNode.children();
    // children: "from", dotted_name, "import", ...
    const nameNode = children.find((ch) => ch.kind() === "dotted_name");
    if (!nameNode) continue;

    const fullName = nameNode.text();
    const topLevel = fullName.split(".")[0];
    if (isPythonImportDeclared(topLevel, ctx, scanRoot)) continue;

    findings.push(makeFinding(
      "undeclared-import",
      ctx,
      importNode,
      `Import '${topLevel}' is not declared in project dependencies`,
      "error",
      `Add '${topLevel}' to your requirements.txt or pyproject.toml`,
    ));
  }

  return findings;
}

export const undeclaredImport: Detector = {
  id: "undeclared-import",
  meta: {
    name: "Undeclared Import",
    description:
      "Detects imports of packages not declared in project manifest files (package.json, requirements.txt, etc.)",
    severity: "error",
    category: "correctness",
    languages: ["javascript", "typescript", "tsx", "python"],
  },
  detect(ctx: DetectionContext): Finding[] {
    // If no manifests found, skip entirely -- we can't know what's declared
    if (ctx.project.manifests.length === 0) {
      return [];
    }

    if (ctx.file.language === "python") {
      return detectPythonUndeclaredImports(ctx);
    }
    return detectJavaScriptUndeclaredImports(ctx);
  },
};
