/** Analytics page pure logic (bead 7yb.5). DOM-free and React-free so the cost
 *  formatting, budget-alert state and chart scaling are unit-testable in
 *  isolation; Analytics.tsx + the SVG charts stay thin renders.
 *
 *  Content-free by the same contract as the served analytics: this consumes only
 *  numbers and model id strings. */

import type { AnalyticsResponse } from '../../api/types.js';

/** Format a USD amount for display. Sub-cent positive values read "<$0.01" so a
 *  real-but-tiny spend never renders as "$0.00". */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (n > 0 && n < 0.01) return '<$0.01';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact token count, e.g. 1_234_567 → "1.23M", 34_500 → "34.5K". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Ratio (0..1) → whole-percent string, e.g. 0.333 → "33%". */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  return `${Math.round(ratio * 100)}%`;
}

/** True when there is no priced token activity at all — the EmptyState signal. */
export function hasNoUsage(a: AnalyticsResponse): boolean {
  return a.pricedMessages === 0 && a.totalCost === 0;
}

/** The largest value in a series, or 0 — the denominator for bar heights. Never
 *  returns a negative or non-finite max, so a bar height is always safe. */
export function chartMax(values: readonly number[]): number {
  let max = 0;
  for (const v of values) {
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/** Fractional bar height (0..1) of `value` against a series max. 0 when max≤0. */
export function barFraction(value: number, max: number): number {
  if (max <= 0 || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / max);
}

/** Budget alert state for a month's spend against an optional threshold.
 *  - `off`  — no budget set.
 *  - `ok`   — under 80% of budget (--signal).
 *  - `near` — 80%..<100% of budget (--warn).
 *  - `over` — at/over budget (--red). */
export type BudgetState = 'off' | 'ok' | 'near' | 'over';

export function budgetAlertState(spend: number, budget: number | undefined): BudgetState {
  if (budget === undefined || !Number.isFinite(budget) || budget <= 0) return 'off';
  if (spend >= budget) return 'over';
  if (spend >= budget * 0.8) return 'near';
  return 'ok';
}

const BUDGET_KEY = 'agentconfig:budget';

/** Read the locally-stored monthly budget threshold (USD), or undefined. The
 *  budget is a NON-SENSITIVE user preference, so it lives in localStorage (unlike
 *  the session token, which never touches storage). Malformed / absent → none. */
export function readBudget(store: Pick<Storage, 'getItem'> | undefined): number | undefined {
  if (!store) return undefined;
  let raw: string | null;
  try {
    raw = store.getItem(BUDGET_KEY);
  } catch {
    return undefined;
  }
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Persist (or clear, when undefined) the monthly budget threshold. Resilient to
 *  a storage that throws (private-mode / disabled). */
export function writeBudget(
  store: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  budget: number | undefined,
): void {
  if (!store) return;
  try {
    if (budget === undefined || !Number.isFinite(budget) || budget <= 0)
      store.removeItem(BUDGET_KEY);
    else store.setItem(BUDGET_KEY, String(budget));
  } catch {
    // storage unavailable — the budget simply doesn't persist this session.
  }
}
