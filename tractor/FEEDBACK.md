# Tractor Feasibility Review: Replacing ast-grep in VibeCop

This document evaluates [Tractor](https://github.com/boukeversteegh/tractor) as
a backend for VibeCop's code quality detectors, replacing the current ast-grep
NAPI-based TypeScript implementation with declarative XPath rules.

---

## Executive Summary

Tractor is **extremely well-suited** for this use case. We ported 15 of VibeCop's
22 rules to Tractor XPath, replacing **3,238 lines of TypeScript** (detectors +
test code) with **258 lines of declarative YAML** — a **27x reduction** — while
maintaining equivalent detection accuracy.

The XPath query language maps naturally to code pattern detection, and Tractor's
`check --rules` workflow with inline `expect-valid`/`expect-invalid` examples is
almost exactly what a linting tool needs. The remaining 7 rules are blocked by
fixable issues (TSX parsing, line counting) or are fundamentally beyond AST scope
(cross-file analysis).

---

## What Works Great

- **XPath is the right abstraction**: Code patterns map naturally to tree queries.
  `//call[function/member[object='console'][property='log']]` is readable even to
  someone who's never seen XPath before.

- **`check --rules` with YAML**: The batch rules format is almost exactly what a
  linting tool needs. Adding `expect-valid` / `expect-invalid` inline examples
  for self-testing rules is brilliant.

- **JSON output with `rule_id`**: The `-f json -v "reason,severity,file,line,column"`
  output is directly mappable to any linting framework's finding format.

- **`-f gcc` and `-f github`**: Native CI integration formats mean VibeCop wouldn't
  even need a wrapper for many use cases.

- **Speed**: Parsing and querying a TypeScript file with 15 rules completes in
  under a second. This is competitive with ast-grep.

- **Multi-language with one syntax**: The same XPath works for JS, TS, and Python
  (with different node names). This is a significant advantage over ast-grep where
  patterns are language-specific.

---

## Before/After Examples

To make the impact concrete, here are side-by-side comparisons of actual VibeCop
detectors and their Tractor equivalents.

### Example 1: `debug-console-in-prod`

**VibeCop (88 lines TypeScript + 157 lines tests = 245 total):**

```typescript
// src/detectors/debug-console-in-prod.ts (abbreviated)
const DEBUG_METHODS = new Set(["log", "debug", "info", "dir", "table", "trace", "group", "groupEnd"]);

function detectJavaScript(ctx: DetectionContext): Finding[] {
  const findings: Finding[] = [];
  if (TEST_FILE_RE.test(ctx.file.path)) return findings;
  const root = ctx.root.root();
  const callExprs = root.findAll({ rule: { kind: "call_expression" } });
  for (const call of callExprs) {
    const children = call.children();
    const callee = children[0];
    if (!callee || callee.kind() !== "member_expression") continue;
    const object = callee.children()[0];
    const property = callee.children().find(ch => ch.kind() === "property_identifier");
    if (!object || !property) continue;
    if (object.text() !== "console") continue;
    const method = property.text();
    if (!DEBUG_METHODS.has(method)) continue;
    const range = call.range();
    findings.push({
      detectorId: "debug-console-in-prod",
      message: `console.${method}() left in production code`,
      severity: "warning",
      file: ctx.file.path,
      line: range.start.line + 1,
      column: range.start.column + 1,
      // ... more fields
    });
  }
  return findings;
}
// + separate detectPython() function
// + Detector interface boilerplate
// + 157 lines of test/detectors/debug-console-in-prod.test.ts
```

**Tractor (13 lines YAML, including inline tests):**

```yaml
- id: debug-console-in-prod
  xpath: >-
    //call[function/member[
      object='console'
    ][
      property='log' or property='debug' or property='info'
      or property='dir' or property='table' or property='trace'
    ]]
  reason: "Debug console statement left in production code."
  severity: warning
  language: typescript
  expect:
    - valid: 'console.error("legit error")'
    - valid: 'console.warn("legit warning")'
    - invalid: 'console.log("debug")'
    - invalid: 'console.debug("trace")'
```

### Example 2: `sql-injection` (template literal variant)

**VibeCop (195 lines TypeScript + 132 lines tests = 327 total):**

```typescript
// Requires: finding call_expressions, checking callee text ends with SQL methods,
// filtering arguments by kind, checking for template_substitution children,
// separate Python branch for f-strings and .format() calls,
// separate handler for binary_expression (string concatenation),
// regex to check for SQL keywords in concatenated strings...
```

**Tractor (8 lines YAML):**

```yaml
- id: sql-injection-template
  xpath: >-
    //call[
      function/member[
        property='query' or property='execute' or property='raw'
        or property='$queryRaw' or property='$queryRawUnsafe'
      ]
    ][arguments//template_substitution]
  reason: "SQL query with template interpolation - potential injection"
  severity: error
  language: typescript
  expect:
    - valid: 'db.query("SELECT * FROM users WHERE id = $1", [id])'
    - invalid: 'db.query(`SELECT * FROM users WHERE id = ${id}`)'
```

### Example 3: `double-type-assertion`

**VibeCop (49 lines TypeScript + 129 lines tests = 178 total):**

```typescript
// Uses REGEX because even ast-grep struggled with this pattern:
const doubleAssertRe = /\bas\s+unknown\s+as\s+/;
const doubleAssertRe2 = /\bas\s+any\s+as\s+/;
// Then manually splits source into lines, skips comments,
// runs regex on each line, extracts match position...
```

**Tractor (5 lines YAML):**

```yaml
- id: double-type-assertion
  xpath: "//as_expression[as_expression]"
  reason: "Double type assertion bypasses TypeScript type safety."
  severity: warning
  language: typescript
  expect:
    - valid: "const x = value as string"
    - invalid: "const x = value as unknown as string"
```

The XPath version is not only shorter — it's structurally correct (matching nested
AST nodes) while VibeCop's regex approach can false-positive on comments and strings.

### Example 4: `token-in-localstorage`

**VibeCop (66 lines TypeScript + 131 lines tests = 197 total):**

```typescript
// Finds all call expressions, checks for member_expression callee,
// verifies object is localStorage/sessionStorage, method is setItem,
// extracts first string argument, checks against keyword list...
```

**Tractor (15 lines YAML):**

```yaml
- id: token-in-localstorage
  xpath: >-
    //call[
      function/member[
        object='localStorage' or object='sessionStorage'
      ][property='setItem']
    ][
      arguments/arguments/string[
        contains(.,'token') or contains(.,'jwt') or contains(.,'auth')
        or contains(.,'session') or contains(.,'secret')
      ]
    ]
  reason: "Auth token in localStorage - vulnerable to XSS"
  severity: error
  expect:
    - valid: 'localStorage.setItem("theme", "dark")'
    - invalid: 'localStorage.setItem("auth_token", jwt)'
```

---

## Blockers & Feedback

### Critical Issues

#### 1. TSX/JSX Parsing is Broken

**Tracking: [boukeversteegh/tractor#67](https://github.com/boukeversteegh/tractor/issues/67)**

**Severity: Blocker for React codebases**

TSX/JSX elements are misparsed as TypeScript type assertions. This makes it
impossible to write rules for React-specific patterns like `dangerouslySetInnerHTML`.

```bash
echo 'const x = <div className="test">hello</div>;' | tractor -l tsx
```

Produces:
```xml
<ERROR>
  const <type>x</type> = <type_arguments>< <type>div</type></type_arguments>
  <type>className</type> = <string>"test"</string>
  ...
</ERROR>
```

Expected: proper `jsx_element` / `jsx_self_closing_element` nodes.

**Impact**: Blocks 2 VibeCop rules (`dangerous-inner-html`, `god-component`) and
any future React/JSX-specific rules.

#### 2. ~~`tractor run` Hangs on File-Based Configs~~ — LIKELY USER ERROR

**Tracking: [todo/20-glob-path-resolution-in-configs.md](https://github.com/boukeversteegh/tractor/blob/main/todo/20-glob-path-resolution-in-configs.md) (glob path resolution)**

**Severity: ~~Major~~ → Low (documentation issue)**

During the experiment I placed config files in `/tmp` and referenced files like
`files: ["poc/test-fixtures/src/*.ts"]`. Since `tractor run` resolves globs
relative to the config file's directory, this would have searched `/tmp/poc/...`
(no match) or, with broader globs, scanned the entire `/tmp` drive — explaining
the apparent hang.

This is exactly the problem described in `todo/20`: globs resolve relative to the
config file with no warning when they match nothing (or match way too much).

**Suggestion**: Warn when file globs match 0 files, and/or show the resolved base
directory in `--verbose` output.

#### 3. `tractor run` and `tractor check --rules` Use Different Config Formats

**Tracking: [boukeversteegh/tractor#65](https://github.com/boukeversteegh/tractor/pull/65) — design doc for unifying formats**

**Severity: Confusing**

`tractor run` expects:
```yaml
check:
  files: [...]
  rules:
    - id: ...
      xpath: ...
```

`tractor check --rules` expects:
```yaml
rules:
  - id: ...
    xpath: ...
```

The file targeting is done via CLI args for `check` but via config for `run`.
Having two incompatible YAML schemas for the same concept is a documentation and
usability burden.

**Suggestion**: Unify the format, or document them side-by-side with clear
"use this when..." guidance.

#### 4. Unknown YAML Keys Are Silently Ignored in `--rules`

**Tracking: [boukeversteegh/tractor#68](https://github.com/boukeversteegh/tractor/issues/68)**

**Severity: Footgun**

When writing rules in `--rules` YAML, unknown keys are silently accepted and
ignored. I initially wrote `expect-valid:` and `expect-invalid:` (by analogy with
the CLI flags `--expect-valid` / `--expect-invalid`) instead of the correct format:

```yaml
# WRONG — silently ignored, no validation happens:
expect-valid:
  - "JSON.parse(data)"
expect-invalid:
  - "eval(userInput)"

# CORRECT — actually validates:
expect:
  - valid: "JSON.parse(data)"
  - invalid: "eval(userInput)"
```

The wrong format produces zero errors or warnings. You only discover it when you
intentionally break an example and nothing happens.

**Suggestion**: Warn on unknown keys in rule definitions, or at minimum reject keys
that look like misspelled versions of known fields (`expect-valid` vs `expect`).

---

### Feature Requests

#### 5. Line Counting — Works via `--meta`, But Hard to Discover and Verbose

**Tracking: [boukeversteegh/tractor#75](https://github.com/boukeversteegh/tractor/issues/75)**

**Severity: ~~High~~ → Low (works, but ergonomics could improve)**

VibeCop's `god-function` detector checks function body line count (>50 lines = warning,
>100 = error). I initially believed this was impossible in Tractor, but it turns out
`--meta` adds `start` and `end` attributes (as `"line:col"` strings) to every element,
and XPath's `substring-before()` can extract the line part:

```xpath
//function[number(substring-before(@end, ':')) - number(substring-before(@start, ':')) > 50]
```

This works but is verbose and hard to discover. I didn't find out that `--meta`
exposed line information until it was pointed out to me. A cleaner syntax would help:

```xpath
//function[lines(.) > 50]           -- ideal: built-in function
//function[@end-line - @start-line > 50]  -- good: separate numeric attributes
```

#### 6. Cyclomatic Complexity Calculation

**Tracking: Likely already expressible — needs documentation of branching node names per language**

**Severity: Medium**

VibeCop counts branching constructs (if/else/for/while/switch/ternary + logical
operators) recursively from a function node. This could potentially be expressed as:

```xpath
//function[
  count(.//if_statement) + count(.//for_statement) + count(.//while_statement) 
  + count(.//switch_statement) + count(.//ternary_expression) > 15
]
```

This actually might already work? I didn't test it because the tree element names
for all these constructs weren't obvious. **A "complexity()" helper function** or
documentation of standard branching node names across languages would be very useful.

#### 7. Node Text Equality Comparison Between Siblings

**Tracking: No existing issue — [needs new issue](#new-issues-to-file)**

**Severity: Medium**

VibeCop's `dead-code-path` detector compares if/else branch contents to detect
identical branches. VibeCop's `trivial-assertion` compares `expect(X).toBe(X)`
where both X are the same literal.

Desired:
```xpath
//if_statement[body = else/body]
```

This kind of "match two subtrees by text content" is common in linting but tricky
in pure XPath.

#### 8. Parent/Ancestor Axis for Context Checks

**Tracking: May already be supported — needs documentation**

**Severity: Medium**

VibeCop's `unchecked-db-result` detector checks if an await expression's result is
assigned to a variable (fire-and-forget detection). This needs ancestor-axis queries:

```xpath
//await[not(ancestor::variable)][.//call[function/member/property='insert']]
```

I'm not sure if Tractor supports `ancestor::` axis. If it does, this wasn't obvious
from the documentation.

#### 9. File-Level Aggregation / Threshold Queries

**Tracking: May already work — needs documentation**

**Severity: Medium**

Several VibeCop rules need per-file counts exceeding a threshold:
- `excessive-any`: files with >3 `any` type annotations
- `excessive-comment-ratio`: files where comments exceed 50% of lines
- `over-mocking`: test files where mock count exceeds assertion count

Desired:
```xpath
//program[count(.//predefined_type[.='any']) > 3]
```

This might already work if `//program` selects the file root. Worth documenting
if so.

#### 10. Negative Lookahead / "Not Followed By" Patterns

**Tracking: May already work with `not()` — needs documentation**

**Severity: Medium**

VibeCop's `unbounded-query` detector finds `findMany()` calls that are NOT followed
by `.take()` or `.limit()`. This "method call without chained safety" pattern is
common in linting.

Desired:
```xpath
//call[function/member/property='findMany'][not(.//member/property='take')]
```

This might be expressible with `not()` but the chaining semantics (`.findMany().take()` 
vs `.findMany()` standalone) are unclear in the tree model.

---

### Usability / Documentation

#### 11. TypeScript Tree Structure is Not Semantically Clean

**Tracking: [todo/12-field-role-elements-all-languages.md](https://github.com/boukeversteegh/tractor/blob/main/todo/12-field-role-elements-all-languages.md) — ongoing work to fix `<type>` overloading and `<ref/>` across all languages**

**Severity: Low-Medium**

The TypeScript semantic tree has some rough edges:

- `<ref/>` appears in many places but it's unclear what it represents
- `<type>` is overloaded — used for variable names, type annotations, and identifiers
- `<bool>` for `true`/`false` is good, but not all boolean-like values are tagged
- `function/member/object` vs `function/member/property` naming is intuitive but
  discovering these paths requires trial-and-error with `tractor file.ts`

**Suggestion**: A "TypeScript tree reference" page showing the semantic tree for
common patterns (function calls, member access, assignments, imports, etc.) would
dramatically speed up rule authoring. The `-v schema` view helps but doesn't show
the full picture.

#### 12. `--rules` YAML Format Undocumented

**Tracking: [boukeversteegh/tractor#69](https://github.com/boukeversteegh/tractor/issues/69)**

**Severity: Medium**

The `check --rules` flag accepts YAML but the expected format (`rules: [{id, xpath, reason, severity}]`)
isn't documented in `--help`. I had to discover it through error messages:

```
invalid type: sequence, expected struct RulesConfig
```

...which told me to wrap rules in a `rules:` key. The `language` and `expect`
fields were discovered by analogy with CLI flags (see also feedback item 4 above — `expect-valid`
and `expect-invalid` are silently ignored in favor of `expect: [{valid: ...}]`).

**Suggestion**: Add a `--rules` format example to `tractor check --help` or document
it in a rules authoring guide.

#### 13. Discovering Tree Node Names is Trial-and-Error

**Tracking: [boukeversteegh/tractor#70](https://github.com/boukeversteegh/tractor/issues/70)**

**Severity: Low**

Writing XPath rules requires knowing the exact element names in Tractor's semantic
tree. During this experiment, I fell into a workflow of running `tractor file.ts`
to see the full XML tree and manually reading it for element names. Only later did
I realize that `tractor file.ts -v schema` (without `-x`) gives a compact structural
overview of all element types in the file — which is actually what I needed.

The `-v schema` view is the right answer here, but it wasn't obvious to reach for.
A couple of things that could help discoverability:

- Mention `-v schema` in the workflow section of `--help` as the recommended first
  step when writing rules (it's currently listed as an option but not highlighted
  in the workflow)
- A per-language reference page (web docs or `tractor schema --lang typescript`)
  showing the canonical element names across a representative code sample would
  still be useful for rule authors who want a quick reference without having
  their own codebase handy

#### 14. ~~No Way to Exclude Files in `check --rules`~~ — RESOLVED

**Status: Already works! Both top-level and per-rule `exclude:` are supported in `--rules` YAML.**

I missed this during the experiment. The following both work:

```yaml
# Top-level exclude
exclude:
  - "**/test-fixtures/**"
rules:
  - id: eval-usage
    xpath: "//call[function='eval']"
    ...

# Or per-rule exclude
rules:
  - id: eval-usage
    xpath: "//call[function='eval']"
    exclude:
      - "**/test-fixtures/**"
    ...
```

This is another case where documenting the `--rules` YAML format (feedback #12)
would have prevented the confusion.

#### 15. Error Output on Exit Code 1

**Tracking: No existing issue — cosmetic, low priority**

**Severity: Cosmetic / Minor**

When `tractor check` finds violations, it exits with code 1 and writes JSON to
**stdout**. This is correct behavior for CI, but the JSON `"success": false` is
misleading — the tool succeeded, it just found issues. Consider `"violations_found": true`
or similar to distinguish "tractor failed" from "tractor found problems".

---

## Priority Summary

| Priority | Feature | Rules Unblocked |
|----------|---------|-----------------|
| P0 | Fix TSX/JSX parsing | `dangerous-inner-html`, `god-component` |
| P0 | Document `check --rules` YAML format | All rules (usability) |
| ~~P1~~ | ~~Line counting function~~ | Works via `--meta` + `substring-before()` — ergonomics issue [#75](https://github.com/boukeversteegh/tractor/issues/75) |
| ~~P1~~ | ~~File exclude in `check --rules`~~ | Already works — undiscovered due to undocumented format (#12) |
| P1 | Unify `run` / `check --rules` config | Usability |
| P2 | Cyclomatic complexity helper or docs | `god-function` (full) |
| P2 | Node text comparison | `dead-code-path`, `trivial-assertion` |
| P2 | Per-file aggregation docs | `excessive-any`, `over-mocking` |
| P3 | Tree node reference docs | All rules (authoring speed) |

---

## <a id="new-issues-to-file"></a>New Issues to File on boukeversteegh/tractor

The following feedback items have no corresponding issue or todo in the Tractor
repository and should be filed as GitHub issues:

### 1. ~~TSX/JSX parsing broken~~ → Filed as [boukeversteegh/tractor#67](https://github.com/boukeversteegh/tractor/issues/67)

### ~~2. `tractor run` hangs when config references file globs~~ — LIKELY USER ERROR
Caused by placing config in `/tmp`, so globs resolved relative to `/tmp` instead
of the project directory. Already tracked in [todo/20](https://github.com/boukeversteegh/tractor/blob/main/todo/20-glob-path-resolution-in-configs.md)
(warn on 0-match globs, document path resolution).

### 3. ~~Unknown YAML keys silently ignored~~ → Filed as [boukeversteegh/tractor#68](https://github.com/boukeversteegh/tractor/issues/68)

### 4. ~~Line counting function~~ → Workaround exists, ergonomics issue filed as [boukeversteegh/tractor#75](https://github.com/boukeversteegh/tractor/issues/75)

### 5. ~~Document `check --rules` YAML format~~ → Filed as [boukeversteegh/tractor#69](https://github.com/boukeversteegh/tractor/issues/69)

### ~~6. Feature: `--exclude` glob for `tractor check`~~ — NOT NEEDED
Already supported via `exclude:` in the `--rules` YAML (both top-level and per-rule). See feedback #14.

### 7. ~~DX: make `-v schema` more discoverable~~ → Filed as [boukeversteegh/tractor#70](https://github.com/boukeversteegh/tractor/issues/70)
