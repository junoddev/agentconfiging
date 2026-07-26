/**
 * Analyzer interface per SPEC §4.1: `{ id, analyze(report) → Finding[] }`.
 *
 * `analyze()` has ZERO I/O — every fact it reasons about comes from the
 * AnalyzerInput object (manifest content, detected agents, parsed models,
 * and the optional caller-populated env bag). This keeps every analyzer
 * fixture-testable from JSON.
 */

import type { Finding } from '../findings.js';
import type { AnalyzerInput } from '../report.js';

export interface Analyzer {
  /** Stable id; MUST equal the module's file basename (registry.test.ts enforces this). */
  id: string;
  /** Pure function: report-carried facts in, findings out. Never touches fs/env/network. */
  analyze(input: AnalyzerInput): Finding[];
}
