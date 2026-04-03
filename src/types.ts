import type { SgRoot } from "@ast-grep/napi";

/** Supported language identifiers */
export type Lang = "javascript" | "typescript" | "tsx" | "python";

/** Finding severity levels */
export type Severity = "error" | "warning" | "info";

/** A detector finds code quality issues in parsed files */
export interface Detector {
  id: string;
  meta: DetectorMeta;
  detect(ctx: DetectionContext): Finding[];
}

/** Metadata describing a detector */
export interface DetectorMeta {
  name: string;
  description: string;
  severity: Severity;
  category: "correctness" | "quality" | "security" | "testing";
  languages: Lang[];
  priority?: number;
}

/** Context passed to each detector for a single file */
export interface DetectionContext {
  file: FileInfo;
  root: SgRoot;
  source: string;
  project: ProjectInfo;
  config: RuleConfig;
}

/** Information about a file being scanned */
export interface FileInfo {
  path: string;
  absolutePath: string;
  language: Lang;
  extension: string;
}

/** A single finding produced by a detector */
export interface Finding {
  detectorId: string;
  message: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  suggestion?: string;
}

/** Project-level information derived from manifest files */
export interface ProjectInfo {
  dependencies: Set<string>;
  devDependencies: Set<string>;
  manifests: string[];
}

/** PR gate configuration for GitHub Action */
export interface PrGateConfig {
  "on-failure": "comment-only" | "request-changes" | "label" | "auto-close";
  label: string;
  "severity-threshold": "error" | "warning" | "info";
  "max-findings": number;
}

/** Top-level vibecop configuration */
export interface VibeCopConfig {
  rules: Record<string, RuleConfig>;
  ignore: string[];
  "pr-gate"?: PrGateConfig;
}

/** Per-rule configuration */
export interface RuleConfig {
  severity?: "error" | "warning" | "info" | "off";
  [key: string]: unknown;
}

/** Result of a complete scan */
export interface ScanResult {
  findings: Finding[];
  filesScanned: number;
  errors: ScanError[];
  timing?: TimingInfo;
}

/** Error encountered during scanning */
export interface ScanError {
  file: string;
  detectorId?: string;
  message: string;
}

/** Timing information for performance tracking */
export interface TimingInfo {
  totalMs: number;
  perDetector: Record<string, number>;
}
