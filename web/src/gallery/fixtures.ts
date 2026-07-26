/** Gallery demo fixtures — fake data exercising every component state.
 *  Pure data + builders; fixtures.test.ts pins the coverage invariants
 *  (all severities shown, multi-hunk diff, VU levels spanning warn range). */

import type { DiffHunk, Severity } from '../components/core/index.js';
import type { ConfigSource } from '../components/signal/index.js';

/** Module-level consts: Waveform compares `sources` by reference, so demo
 *  source arrays must be stable across renders. */
export const CLAUDE_SOURCES: readonly ConfigSource[] = [
  { path: 'CLAUDE.md', size: 3120, hash: 'a1b2c3d4' },
  { path: '.claude/settings.json', size: 512, hash: '9f8e7d6c' },
];

export const CODEX_SOURCES: readonly ConfigSource[] = [
  { path: 'AGENTS.md', size: 5934, hash: '11aa22bb' },
  { path: '.codex/config.toml', size: 244, hash: 'cc33dd44' },
];

export interface FindingFixture {
  index: number;
  severity: Severity;
  title: string;
  fix?: string;
  /** True when a machine fix exists — the gallery renders [APPLY] for it. */
  applicable?: boolean;
}

/** One finding per severity; covers fix-with-apply, fix-only, and bare. */
export function buildDemoFindings(): FindingFixture[] {
  return [
    {
      index: 1,
      severity: 'error',
      title: '.claude/settings.local.json is committed',
      fix: 'add .claude/settings.local.json to .gitignore',
      applicable: true,
    },
    {
      index: 2,
      severity: 'warn',
      title: 'CLAUDE.md build commands section is empty',
      fix: 'add build & test commands',
    },
    { index: 3, severity: 'ok', title: 'SIGNAL ACQUIRED' },
  ];
}

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

/** VU meter demo levels: dead, low, mid, warn threshold, full scale.
 *  0.8 is the default `warnFrom` — the last two exercise the warn range. */
export const VU_LEVELS: readonly number[] = [0, 0.2, 0.5, 0.8, 1];
