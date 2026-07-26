/** Dashboard page pure logic (bead 7yb.2). DOM-free and React-free so the stat
 *  formatting is unit-testable in isolation; Dashboard.tsx stays a thin render.
 *
 *  Content-free by the same contract as the served stats: this consumes only
 *  numbers, runtime ids, and achievement metadata. */

import type { AchievementsPayload, DashboardStats } from '../../api/types.js';

/** Group an integer with thousands separators, e.g. 12345 → "12,345". */
export function groupThousands(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.trunc(n).toLocaleString('en-US');
}

/** Terse caps runtime list for the §7 voice, e.g. ['claude'] → "CLAUDE". Empty
 *  → "—" (a dead-signal placeholder, never a fabricated runtime). */
export function formatRuntimes(runtimes: readonly string[]): string {
  if (runtimes.length === 0) return '—';
  return runtimes.map((r) => r.toUpperCase()).join(' · ');
}

/** Achievement tally label, e.g. "7 / 22 UNLOCKED". */
export function achievementProgressLabel(achievements: AchievementsPayload): string {
  const unlocked = achievements.unlocked.length;
  const total = unlocked + achievements.locked.length;
  return `${unlocked} / ${total} UNLOCKED`;
}

/** VU level (0..1) for the current level's progress, clamped defensively. */
export function levelProgressLevel(stats: DashboardStats): number {
  const p = stats.xp.levelProgress;
  if (!Number.isFinite(p)) return 0;
  return Math.min(1, Math.max(0, p));
}

/** True when there is no session history at all — the EmptyState signal. */
export function hasNoHistory(stats: DashboardStats): boolean {
  return stats.sessionCount === 0 && stats.messageCounts.total === 0 && stats.promptCount === 0;
}

/** One-line activity-range caption, e.g. "2026-01-02 → 2026-07-26". Empty when
 *  no activity exists. */
export function activityRange(stats: DashboardStats): string {
  if (stats.firstActiveDate === undefined || stats.lastActiveDate === undefined) return '';
  if (stats.firstActiveDate === stats.lastActiveDate) return stats.firstActiveDate;
  return `${stats.firstActiveDate} → ${stats.lastActiveDate}`;
}
