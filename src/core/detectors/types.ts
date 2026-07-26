/**
 * Detector interface per SPEC §4.1:
 * `{ id, matches(manifest), extract(manifest) } → DetectedAgent` with
 * `{ kind, confidence: low|medium|high, files, extras }`.
 *
 * Ported from ../markdowning `apps/agentconfig/lib/agentconfig/inspect/`
 * (`detectors.ex` behaviour + `detected_agent.ex` struct).
 *
 * `kind` is a stable string (kebab-case, equals the detector id).
 * `extras` is an open metadata bag — each detector puts whatever
 * runtime-specific metadata it extracted there.
 */

import type { Manifest } from '../manifest.js';

export type Confidence = 'low' | 'medium' | 'high';

export interface DetectedAgent {
  /** Stable runtime identifier, e.g. 'claude-code'. Equals the detector id. */
  kind: string;
  /** Qualitative rating from the per-detector count-signals heuristic. */
  confidence: Confidence;
  /** Manifest file paths that contributed to detection. */
  files: string[];
  /** Open metadata bag of extracted per-runtime details. */
  extras: Record<string, unknown>;
}

export interface Detector {
  /** Stable id; MUST equal the module's file basename (registry.test.ts enforces this). */
  id: string;
  /** Pure predicate: does this runtime have any presence in the manifest? */
  matches(manifest: Manifest): boolean;
  /** Pure extraction; only called when matches() is true. */
  extract(manifest: Manifest): DetectedAgent;
}
