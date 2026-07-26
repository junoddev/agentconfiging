/**
 * Instruction-sync engine types (SPEC §4.1, E5 — bead agentconfig-wmc.10).
 *
 * The engine is a PURE transformation: given ONE source instruction file
 * (content only) and a set of TARGET runtime formats (from the RUNTIME_FORMATS
 * table), it produces the content each target's primary instruction file should
 * hold. Zero I/O lives here — the caller reads the source, decides targets, and
 * (server-side) diffs/writes the results through the ONE guarded write path.
 */

import type { InstructionFormat, InstructionLayout } from '../runtimes/types.js';

/** The designated source of truth: a single instruction file's raw content. */
export interface SyncSource {
  /**
   * Project-relative path of the source file. Used ONLY to skip a target that
   * would regenerate the source itself (e.g. source `AGENTS.md` never emits an
   * `AGENTS.md` target). Never read from disk here.
   */
  path: string;
  /** Raw file content (frontmatter, if any, is detected + stripped by the engine). */
  content: string;
}

/** Per-target sync freshness — computed against the on-disk target (caller side). */
export type SyncStatus = 'new' | 'changed' | 'in-sync';

/**
 * One planned target file. Because several runtimes share a primary instruction
 * file (Codex + opencode both read `AGENTS.md`), plan entries are keyed by PATH
 * and carry every runtime that reads it.
 */
export interface SyncPlanEntry {
  /** Concrete project-relative file the engine would write. */
  path: string;
  /** Fully generated content for `path` (source body ± target frontmatter). */
  content: string;
  format: InstructionFormat;
  layout: InstructionLayout;
  /** Runtime ids that read `path` (>= 1), sorted for determinism. */
  runtimeIds: string[];
  /** Display names paralleling `runtimeIds`. */
  displayNames: string[];
  /**
   * True when the mapping is APPROXIMATE — it invents metadata the source did
   * not carry (synthesized frontmatter) or collapses a rules directory to a
   * single file. `note` explains what was approximated.
   */
  lossy: boolean;
  note?: string;
}
