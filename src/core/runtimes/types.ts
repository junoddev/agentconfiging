/**
 * Runtime instruction-format knowledge (SPEC §4.1) — the schema for the
 * data-file-driven runtime table in `table.ts`.
 *
 * One `RuntimeFormat` entry describes how a runtime consumes project
 * instructions (plain vs frontmattered markdown, single file vs rules
 * directory, project vs global scope). The instruction sync engine (E5)
 * uses this table to regenerate instruction files across runtimes and to
 * scaffold configs for runtimes the user does not have yet; detection-lite
 * uses `detectionMarkers` to spot long-tail runtimes that have no
 * first-class detector module.
 *
 * This is pure data + a few pure accessors (see `index.ts`) — no per-runtime
 * executable logic lives here.
 */

/** Format of the runtime's primary instruction file(s). */
export type InstructionFormat = 'markdown' | 'frontmattered-markdown';

/**
 * How instruction content is laid out on disk:
 * - 'single-file': one instruction file (e.g. CLAUDE.md, .rules).
 * - 'rules-dir':   a directory of rule files (e.g. .amazonq/rules/*.md).
 * - 'hybrid':      both forms exist (usually a legacy single file plus a
 *                  newer rules directory, e.g. .cursorrules + .cursor/rules/).
 */
export type InstructionLayout = 'single-file' | 'rules-dir' | 'hybrid';

/**
 * How trustworthy this entry's format facts are. These tools move fast;
 * 'unverified' entries keep facts minimal and must be re-checked before the
 * sync engine treats them as authoritative.
 */
export type FactConfidence = 'verified' | 'unverified';

export interface RuntimeFormat {
  /**
   * Stable kebab-case runtime id. For first-class runtimes this MUST equal
   * the detector id in `src/core/detectors` (enforced by runtimes.test.ts).
   */
  id: string;
  displayName: string;
  /** True when a full detector module exists in src/core/detectors. */
  firstClass: boolean;
  /** Format of the primary (first) instruction path. */
  format: InstructionFormat;
  layout: InstructionLayout;
  /**
   * Ordered instruction-location candidates, project-root-relative, most
   * preferred first. A trailing '/' marks a rules directory; anything else
   * is a single file. The sync engine writes to the first candidate unless
   * one of the later (legacy) candidates already exists.
   */
  instructionPaths: string[];
  /**
   * Glob (project-root-relative) matching individual rule files, present
   * exactly when `layout` is 'rules-dir' or 'hybrid'.
   */
  rulesDirPattern?: string;
  /**
   * User-global instruction locations, '~/'-prefixed. Informational only —
   * the sync engine never writes outside the project.
   */
  globalPaths?: string[];
  /** Free-form scope/behavior caveats (legacy fallbacks, load mechanics). */
  scopeNotes?: string;
  /**
   * File the sync engine creates when scaffolding this runtime. Always the
   * primary instruction file, or a starter rule file inside the primary
   * rules directory.
   */
  scaffoldPath: string;
  /** Minimal starter content for `scaffoldPath`. */
  scaffoldTemplate: string;
  /**
   * Detection-lite markers: exact project-relative file path, or a
   * directory prefix when ending in '/'. For first-class runtimes every
   * marker is also a match trigger of the corresponding detector module
   * (cross-checked by runtimes.test.ts).
   */
  detectionMarkers: string[];
  docsUrl: string;
  confidence: FactConfidence;
}

/** One detection-lite marker, flattened from the table (see `detectionMarkers`). */
export interface DetectionLiteMarker {
  runtimeId: string;
  /** Exact relative path, or a directory prefix when ending in '/'. */
  marker: string;
}
