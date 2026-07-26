/**
 * Analyzer registry — same auto-discovery mechanism as the detector
 * registry (SPEC §4.1); see src/core/detectors/registry.ts for the full
 * rationale (Elixir's hardcoded module list was a documented footgun; the
 * tsup bundle cannot fs-readdir source dirs at runtime).
 *
 * Pattern:
 *   1. Each analyzer module calls `registerAnalyzer(...)` at module
 *      top-level (a side effect of being imported).
 *   2. The directory barrel (`index.ts`) has one explicit
 *      `import './<analyzer>.js'` line per module — the only wiring.
 *   3. `registry.test.ts` fs-reads THIS directory's listing and asserts
 *      every non-infrastructure `*.ts` file is represented in the registry
 *      (analyzer id === file basename).
 */

import type { Analyzer } from './types.js';

const registry = new Map<string, Analyzer>();

/** Called by each analyzer module at import time. Throws on duplicate ids. */
export function registerAnalyzer(analyzer: Analyzer): void {
  if (registry.has(analyzer.id)) {
    throw new Error(`Analyzer already registered: ${analyzer.id}`);
  }
  registry.set(analyzer.id, analyzer);
}

/** All registered analyzers, sorted by id for deterministic output order. */
export function allAnalyzers(): Analyzer[] {
  return [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
