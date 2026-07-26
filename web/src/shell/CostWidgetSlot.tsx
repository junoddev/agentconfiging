/**
 * Persistent chrome COST WIDGET (DESIGN §5 feature #15, bead 7yb.5). Fills the
 * top-bar slot the shell reserved (E4 stub) with this month's API-equivalent
 * spend and a BUDGET ALERT: when the month's cost crosses a user-set threshold
 * the pill shifts to a `--warn` (near) or `--red` (over) state.
 *
 * DATA: reads the same content-free `/api/analytics` aggregate the Analytics page
 * uses (`currentMonthCost`) — token counts/costs only, never a message body. Like
 * the analytics/dashboard pages, the shell keeps its ApiClient private, so the
 * widget captures the launch token at module load and builds its own client.
 *
 * BUDGET STORAGE: the threshold is a NON-SENSITIVE user preference (a dollar
 * amount), so — unlike the session token, which never touches storage — it lives
 * in `localStorage` under `agentconfig:budget`. Click the pill to set/clear it.
 *
 * Renders nothing until the first fetch resolves, so the chrome never flashes a
 * placeholder or an invented figure.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { budgetAlertState, formatUsd, readBudget, writeBudget } from '../pages/analytics/logic.js';
import '../pages/analytics.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

function storage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    // Storage disabled (private mode / sandbox) — the widget still shows spend.
    return undefined;
  }
}

export function CostWidgetSlot() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const [spend, setSpend] = useState<number | undefined>();
  const [budget, setBudget] = useState<number | undefined>(() => readBudget(storage()));

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    void (async () => {
      try {
        const res = await client.getAnalytics();
        if (!cancelled) setSpend(res.currentMonthCost);
      } catch {
        // A failed/absent history leaves the slot empty — never a crash.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Nothing to show until the first figure arrives.
  if (spend === undefined) {
    return <div className="topbar__cost" data-slot="cost-widget" aria-hidden="true" />;
  }

  const state = budgetAlertState(spend, budget);
  const promptBudget = () => {
    const current = budget === undefined ? '' : String(budget);
    const next = window.prompt('Monthly budget (USD) — blank to clear the alert:', current);
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    const parsed = trimmed === '' ? undefined : Number(trimmed);
    const clean =
      parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    writeBudget(storage(), clean);
    setBudget(clean);
  };

  const title =
    budget === undefined
      ? `This month: ${formatUsd(spend)} (API-equivalent). Click to set a budget alert.`
      : `This month: ${formatUsd(spend)} of ${formatUsd(budget)} budget. Click to change.`;

  return (
    <div className="topbar__cost" data-slot="cost-widget">
      <button
        type="button"
        className={`cost-widget cost-widget--${state}`}
        onClick={promptBudget}
        title={title}
      >
        <span className="cost-widget__dot" aria-hidden="true" />
        <span className="cost-widget__label">MO</span>
        <span>{formatUsd(spend)}</span>
      </button>
    </div>
  );
}
