/**
 * Pure transforms for the workspace manager's scan results. Kept free of React
 * so they are unit-testable in isolation (see hits.test.ts). Nothing here
 * touches the DOM — the page renders every path as a text node.
 */

import type { ScanHit, ScanStats } from '../../api/types.js';

/** A scan hit annotated with whether its root is already a workspace instance. */
export interface AnnotatedHit extends ScanHit {
  /** True when an instance already covers this root — the [ADD] is then disabled. */
  added: boolean;
}

/**
 * Mark each hit as already-added when its `root` matches an existing instance
 * root, so the UI can disable a redundant [ADD]. Order is preserved (the server
 * already returns hits deterministically).
 */
export function annotateHits(hits: ScanHit[], instanceRoots: Iterable<string>): AnnotatedHit[] {
  const existing = new Set(instanceRoots);
  return hits.map((hit) => ({ ...hit, added: existing.has(hit.root) }));
}

/**
 * Terse, all-caps stats line for the §7 voice: `142 DIRS · 3 SKIPPED · TRUNCATED`.
 * Skipped is omitted when zero; TRUNCATED appears only when the walk was capped.
 */
export function formatScanStats(stats: ScanStats): string {
  const parts = [`${stats.dirsVisited} DIRS`];
  if (stats.skipped > 0) parts.push(`${stats.skipped} SKIPPED`);
  if (stats.truncated) parts.push('TRUNCATED');
  return parts.join(' · ');
}
