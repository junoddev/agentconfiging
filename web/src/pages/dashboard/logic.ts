/** Dashboard page pure logic (bead 7yb.2). DOM-free and React-free so the stat
 *  formatting is unit-testable in isolation; Dashboard.tsx stays a thin render.
 *
 *  Content-free by the same contract as the served stats: this consumes only
 *  numbers, runtime ids, and achievement metadata. */

import type { AchievementsPayload, DashboardStats, UsageSummary } from '../../api/types.js';

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

/** Token count for usage tiles. Empty usage is unknown, not "0 tokens". */
export function formatUsageTokens(usage: UsageSummary): string {
  if (usage.messagesWithUsage === 0) return '—';
  return groupThousands(usage.tokens.totalTokens);
}

export function formatUsageInputTokens(usage: UsageSummary): string {
  if (usage.messagesWithUsage === 0) return '—';
  return groupThousands(usage.tokens.inputTokens);
}

export function formatUsageOutputTokens(usage: UsageSummary): string {
  if (usage.messagesWithUsage === 0) return '—';
  return groupThousands(usage.tokens.outputTokens);
}

/** USD cost label. Omitted `amountUsd` stays unknown. */
export function formatUsageCost(usage: UsageSummary): string {
  if (usage.cost.amountUsd === undefined) return 'unknown';
  const amount = usage.cost.amountUsd;
  if (amount > 0 && amount < 0.01) return '<$0.01';
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function usageMessagesCaption(usage: UsageSummary): string {
  const n = usage.messagesWithUsage;
  return `${groupThousands(n)} usage message${n === 1 ? '' : 's'}`;
}

/** Short controlled caption for the aggregate cost tile. */
export function costCaption(usage: UsageSummary): string {
  if (usage.messagesWithUsage === 0) return 'no usage blocks';
  if (usage.cost.status === 'known') {
    const n = usage.messagesWithUsage;
    return `${n} usage message${n === 1 ? '' : 's'}`;
  }
  if (usage.cost.status === 'partial') {
    const n = usage.cost.unpricedMessages + usage.assistantMessagesWithoutUsage;
    return `${n} unpriced message${n === 1 ? '' : 's'}`;
  }
  return 'model pricing unknown';
}
