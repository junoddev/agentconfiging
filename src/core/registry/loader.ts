/**
 * Seed loader (SPEC §4.5) — the thin bridge from the shipped seed snapshot to
 * a validated RegistryIndex.
 *
 * The seed snapshot (./seed/index.json) is embedded at build time: it is
 * imported as a JSON module, so the bundler inlines it into the shipped
 * package and the catalog works OFFLINE on first run with zero I/O. Even
 * though we author the seed, it flows through the SAME untrusted-input
 * validator as any fetched index — the seed is data, not a trusted fast path.
 *
 * How agentconfig-0zm.2 (the fetch client) layers over this:
 *
 *   1. On first paint the UI/catalog uses `loadSeedIndex()` — always available.
 *   2. The fetch client pulls the external `agentconfig-registry` index over
 *      HTTPS into a local cache, running it through `parseRegistryIndex` too.
 *   3. The effective catalog is the fetched index when present and valid,
 *      otherwise the seed. Entries are keyed by (kind, name); a fetched entry
 *      supersedes a seed entry with the same key. The seed therefore acts as
 *      the offline floor and the fetched cache as the fresh overlay.
 *   4. Merge/overlay logic and the cache itself live in 0zm.2 — this module
 *      stays a pure accessor over the embedded seed.
 *
 * Pure module: the seed is a compile-time import, so there is no runtime I/O.
 */

import seedRaw from './seed/index.json';
import { parseRegistryIndex, type RegistryParseResult } from './validate.js';

/**
 * Validate and return the embedded seed index. Because the seed is authored
 * to be well-formed, `result.issues` is expected to be empty; a non-empty
 * issues list here is a seed-integrity bug (guarded by the seed tests).
 */
export function loadSeed(): RegistryParseResult {
  return parseRegistryIndex(seedRaw);
}

/** Convenience: just the validated seed index (drops the issues report). */
export function loadSeedIndex() {
  return loadSeed().index;
}
