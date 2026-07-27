/**
 * Pure transforms for the workspace manager's KNOWN-PROJECT suggestions (bead
 * qoc.3). Kept free of React so they are unit-testable in isolation (see
 * suggestions.test.ts). Nothing here touches the DOM — the page renders every
 * root path as a text node.
 */

import type { KnownProject } from '../../api/types.js';

/**
 * Drop suggestions whose root is already a workspace instance. The server
 * already excludes registered roots, but the page owns a live instance list that
 * changes the instant a suggestion is added — filtering here makes the just-added
 * row disappear immediately, before the next server fetch. Order is preserved
 * (the server returns suggestions deterministically, most-recent first).
 */
export function pruneKnownProjects(
  projects: KnownProject[],
  instanceRoots: Iterable<string>,
): KnownProject[] {
  const existing = new Set(instanceRoots);
  return projects.filter((p) => !existing.has(p.root));
}

/**
 * Terse, all-caps metadata line for the §7 voice: `3 SESSIONS · LAST 2026-07-26`.
 * The last-seen date is the UTC calendar day (never a time-of-day); it is omitted
 * when the project carries no `lastSeen`.
 */
export function formatKnownMeta(project: KnownProject): string {
  const n = project.sessionCount;
  const parts = [`${n} SESSION${n === 1 ? '' : 'S'}`];
  if (project.lastSeen !== undefined) {
    const day = project.lastSeen.slice(0, 10);
    if (day !== '') parts.push(`LAST ${day}`);
  }
  return parts.join(' · ');
}
