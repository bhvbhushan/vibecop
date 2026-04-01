import { describe, expect, test } from "bun:test";
import { parse, Lang } from "@ast-grep/napi";
import { godComponent } from "../../src/detectors/god-component.js";
import type { DetectionContext, FileInfo, ProjectInfo } from "../../src/types.js";

const EMPTY_PROJECT: ProjectInfo = {
  dependencies: new Set(),
  devDependencies: new Set(),
  manifests: [],
};

function makeCtx(
  source: string,
  options: {
    language?: "typescript" | "tsx";
    filePath?: string;
  } = {},
): DetectionContext {
  const language = options.language ?? "tsx";
  const langMap: Record<string, Lang> = {
    typescript: Lang.TypeScript,
    tsx: Lang.Tsx,
  };
  const extMap: Record<string, string> = {
    typescript: ".ts",
    tsx: ".tsx",
  };
  const defaultPath = `src/Component.${extMap[language].slice(1)}`;
  const filePath = options.filePath ?? defaultPath;
  const root = parse(langMap[language], source);
  const file: FileInfo = {
    path: filePath,
    absolutePath: `/${filePath}`,
    language,
    extension: extMap[language],
  };
  return { file, root, source, project: EMPTY_PROJECT, config: {} };
}

/** Generate N import statements */
function generateImports(n: number): string {
  return Array.from({ length: n }, (_, i) => `import mod${i} from "pkg-${i}";`).join("\n");
}

/** Generate N lines of filler JSX */
function generateJsxLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `      <div key={${i}}>Line {${i}}</div>`).join("\n");
}

describe("god-component", () => {
  test("detector has correct metadata", () => {
    expect(godComponent.id).toBe("god-component");
    expect(godComponent.meta.severity).toBe("warning");
    expect(godComponent.meta.category).toBe("quality");
    expect(godComponent.meta.languages).toContain("tsx");
  });

  test("simple component with 1 useState produces no finding", () => {
    const ctx = makeCtx(`
      import React from "react";
      import { useState } from "react";

      export function MyComponent() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `);
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("component exceeding 2+ thresholds produces finding", () => {
    // Exceed: useState (6 > 5), useEffect (4 > 3), imports (20 > 15), lines (>300)
    const imports = generateImports(20);
    const filler = generateJsxLines(250);
    const ctx = makeCtx(`
${imports}
import React from "react";
import { useState, useEffect } from "react";

export function GodComponent() {
  const [a, setA] = useState(0);
  const [b, setB] = useState("");
  const [c, setC] = useState(false);
  const [d, setD] = useState(null);
  const [e, setE] = useState([]);
  const [f, setF] = useState({});

  useEffect(() => { console.log(a); }, [a]);
  useEffect(() => { console.log(b); }, [b]);
  useEffect(() => { console.log(c); }, [c]);
  useEffect(() => { console.log(d); }, [d]);

  return (
    <div>
${filler}
    </div>
  );
}
    `);
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(1);
    expect(findings[0].detectorId).toBe("god-component");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("hooks");
  });

  test("component exceeding only 1 threshold produces no finding", () => {
    // Only exceed useState (6 > 5), nothing else
    const ctx = makeCtx(`
      import React from "react";
      import { useState } from "react";

      export function OneThreshold() {
        const [a, setA] = useState(0);
        const [b, setB] = useState("");
        const [c, setC] = useState(false);
        const [d, setD] = useState(null);
        const [e, setE] = useState([]);
        const [f, setF] = useState({});

        return <div>Hello</div>;
      }
    `);
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("non-TSX file produces no finding", () => {
    const ctx = makeCtx(
      `
      import React from "react";
      const Component = () => { return null; };
      `,
      { language: "typescript" },
    );
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("test file produces no finding", () => {
    const imports = generateImports(20);
    const ctx = makeCtx(
      `
${imports}
import React from "react";
import { useState, useEffect } from "react";

export function TestComponent() {
  const [a, setA] = useState(0);
  const [b, setB] = useState("");
  const [c, setC] = useState(false);
  const [d, setD] = useState(null);
  const [e, setE] = useState([]);
  const [f, setF] = useState({});

  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);

  return <div>Test</div>;
}
      `,
      { filePath: "src/Component.test.tsx" },
    );
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(0);
  });

  test("file without JSX produces no finding", () => {
    const imports = generateImports(20);
    const ctx = makeCtx(`
${imports}
import { useState, useEffect } from "react";

export function notAComponent() {
  const [a, setA] = useState(0);
  const [b, setB] = useState("");
  const [c, setC] = useState(false);
  const [d, setD] = useState(null);
  const [e, setE] = useState([]);
  const [f, setF] = useState({});

  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);
  useEffect(() => {}, []);

  return { a, b, c, d, e, f };
}
    `);
    const findings = godComponent.detect(ctx);
    expect(findings.length).toBe(0);
  });
});
