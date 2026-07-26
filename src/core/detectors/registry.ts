/**
 * Detector registry — the auto-discovery mechanism (SPEC §4.1).
 *
 * The Elixir version kept a hardcoded `@detectors` module list in
 * `detectors.ex`; forgetting to add a new module there was a documented
 * footgun. We cannot fs-readdir source directories at runtime instead:
 * tsup bundles the ESM output, so the source tree does not exist where
 * the code runs.
 *
 * Chosen pattern (bundle-safe):
 *   1. Each detector module calls `registerDetector(...)` at module
 *      top-level (a side effect of being imported).
 *   2. The directory barrel (`index.ts`) has one explicit
 *      `import './<detector>.js'` line per module — the only wiring.
 *   3. `registry.test.ts` fs-reads THIS directory's listing and asserts
 *      every non-infrastructure `*.ts` file is represented in the
 *      registry (detector id === file basename). Adding `foo.ts` without
 *      its barrel import fails that test — the footgun is now a red
 *      test instead of silent misdetection.
 */

import type { Manifest } from '../manifest.js';
import type { DetectedAgent, Detector } from './types.js';

const registry = new Map<string, Detector>();

/** Called by each detector module at import time. Throws on duplicate ids. */
export function registerDetector(detector: Detector): void {
  if (registry.has(detector.id)) {
    throw new Error(`Detector already registered: ${detector.id}`);
  }
  registry.set(detector.id, detector);
}

/** All registered detectors, sorted by id for deterministic output order. */
export function allDetectors(): Detector[] {
  return [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Run every registered detector over the manifest. Pure, zero I/O —
 * fixture-testable. Result order is deterministic (detector id order).
 */
export function detect(manifest: Manifest): DetectedAgent[] {
  return allDetectors()
    .filter((d) => d.matches(manifest))
    .map((d) => d.extract(manifest));
}
