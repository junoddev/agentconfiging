/**
 * Pure helpers for the instruction-sync page (bead agentconfig-wmc.10). DOM-free
 * and I/O-free so they unit-test in isolation; the page (../Sync.tsx) wires them
 * to the API client + write preview.
 */

import type { SyncStatus, SyncTarget } from '../../api/index.js';

/**
 * Canonical source-of-truth candidates (SPEC §4.1: "e.g. CLAUDE.md or a canonical
 * rules dir"). These are the portable, single-file guides most likely to be the
 * authoritative instruction file; the server 404s any that is absent in the
 * instance, which the page surfaces.
 */
export const SOURCE_CANDIDATES: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
];

/** A target is writable-and-actionable when it would create or change a file. */
export function isActionable(target: SyncTarget): boolean {
  return target.status === 'new' || target.status === 'changed';
}

/**
 * Default selection when a plan loads: every actionable target (drift + missing),
 * skipping in-sync and unwritable rows. Returns the set of target paths.
 */
export function defaultSelection(targets: readonly SyncTarget[]): Set<string> {
  return new Set(targets.filter(isActionable).map((t) => t.path));
}

/** Human, lowercase status label (§7 voice). */
export function statusLabel(status: SyncStatus): string {
  switch (status) {
    case 'new':
      return 'missing';
    case 'changed':
      return 'drifted';
    case 'in-sync':
      return 'in sync';
    case 'unwritable':
      return 'unwritable';
  }
}

/** Signal-grid tone class suffix for a status (drives the badge color). */
export function statusTone(status: SyncStatus): 'signal' | 'warn' | 'dim' {
  switch (status) {
    case 'changed':
      return 'warn';
    case 'new':
      return 'signal';
    case 'in-sync':
    case 'unwritable':
      return 'dim';
  }
}

/**
 * The runtime ids to send on commit: the union across the SELECTED target rows.
 * A row can front several runtimes (Codex + opencode → AGENTS.md), so selecting
 * it selects all of them. Deterministic (sorted, de-duped).
 */
export function selectedRuntimeIds(
  targets: readonly SyncTarget[],
  selectedPaths: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  for (const t of targets) {
    if (selectedPaths.has(t.path)) for (const id of t.runtimeIds) ids.add(id);
  }
  return [...ids].sort();
}

/** Counts for the summary line: drifted, missing, in-sync, unwritable. */
export function planSummary(targets: readonly SyncTarget[]): {
  drifted: number;
  missing: number;
  inSync: number;
  unwritable: number;
} {
  let drifted = 0;
  let missing = 0;
  let inSync = 0;
  let unwritable = 0;
  for (const t of targets) {
    if (t.status === 'changed') drifted += 1;
    else if (t.status === 'new') missing += 1;
    else if (t.status === 'in-sync') inSync += 1;
    else unwritable += 1;
  }
  return { drifted, missing, inSync, unwritable };
}
