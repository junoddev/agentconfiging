/** Gallery demo fixtures — fake data exercising every component state.
 *  Pure data + builders; fixtures.test.ts pins the coverage invariants
 *  (multi-hunk diff, full heatmap intensity range). */

import type { DiffHunk } from '../components/core/index.js';

/** Multi-hunk unified diff for the DiffPanel demo. */
export function buildDemoDiff(): DiffHunk[] {
  return [
    {
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'ctx', text: 'node_modules/' },
        { kind: 'ctx', text: 'dist/' },
        { kind: 'del', text: '.env' },
        { kind: 'add', text: '.env*' },
        { kind: 'add', text: '.claude/settings.local.json' },
      ],
    },
    {
      header: '@@ -12,2 +13,3 @@',
      lines: [
        { kind: 'ctx', text: 'coverage/' },
        { kind: 'add', text: '.agentconfig/cache/' },
        { kind: 'ctx', text: '*.log' },
      ],
    },
  ];
}

/** Deterministic 8-week activity window for the Heatmap demo: every
 *  intensity level 0–4 appears, dates are sequential UTC days. */
export function buildDemoHeatmap(): { date: string; count: number }[] {
  const start = Date.parse('2026-06-01T00:00:00Z');
  const counts = [0, 1, 3, 6, 9, 12, 0, 2];
  return Array.from({ length: 56 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    count: counts[i % counts.length]! + (i % 13 === 0 ? 4 : 0),
  }));
}
