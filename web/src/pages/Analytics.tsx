/**
 * Analytics (rail `19 ANALYTICS`, route `#/analytics`) — the TOKEN/COST view
 * (SPEC §5 row 15, bead 7yb.5). Server-derived aggregates from THIS machine's
 * runtime history: token totals + API-equivalent cost per model, cache
 * efficiency, a daily cost trend and an hour-of-day activity profile. Rendered as
 * Signal Grid stat blocks, a hairline table, and hand-rolled SVG charts
 * (DESIGN §6).
 *
 * The served analytics are CONTENT-FREE (token counts, USD costs, model ids,
 * trend buckets — never message bodies). Costs are API-equivalent estimates from
 * logged token counts (see the plan note); a flat-rate subscription bills
 * differently. Every value here is a number or an opaque model id, rendered as a
 * text node only.
 *
 * CLIENT SEAM: like the Dashboard, the shell keeps its ApiClient private, so this
 * page captures the launch token at module load and builds its own client.
 */

import { useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type AnalyticsResponse } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { EmptyState, StatBlock, Table } from '../components/core/index.js';
import { BarChart } from './analytics/charts.js';
import { chartMax, formatPct, formatTokens, formatUsd, hasNoUsage } from './analytics/logic.js';
import './analytics.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load token analytics';
}

/** Evenly-sampled axis captions from a label list (first, ~mid, last). */
function sampleAxis(labels: readonly string[]): string[] {
  if (labels.length === 0) return [];
  if (labels.length <= 3) return [...labels];
  const mid = labels[Math.floor((labels.length - 1) / 2)] as string;
  return [labels[0] as string, mid, labels[labels.length - 1] as string];
}

export function Analytics() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [data, setData] = useState<AnalyticsResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      setErrMsg('session token missing');
      return;
    }
    setStatus('loading');
    void (async () => {
      try {
        const res = await client.getAnalytics();
        if (cancelled) return;
        setData(res);
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setErrMsg(loadError(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const dailyBars = useMemo(
    () =>
      (data?.daily ?? []).map((d) => ({
        key: d.date,
        value: d.cost,
        title: `${d.date}: ${formatUsd(d.cost)} · ${formatTokens(d.tokens)} tokens`,
      })),
    [data],
  );
  const hourlyBars = useMemo(
    () =>
      (data?.hourly ?? []).map((h) => ({
        key: String(h.hour),
        value: h.messages,
        title: `${String(h.hour).padStart(2, '0')}:00 UTC — ${h.messages} messages · ${formatTokens(h.tokens)} tokens`,
      })),
    [data],
  );

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">ANALYTICS</h1>
        <p className="an__lede micro-label">
          token usage &amp; API-equivalent cost from this machine&apos;s runtime history — per
          model, cache efficiency, daily trend &amp; hourly activity
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="micro-label an__acquiring">ACQUIRING SIGNAL</p>
        </section>
      )}

      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && data && hasNoUsage(data) && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction="no token usage recorded yet" />
        </section>
      )}

      {status === 'ok' && data && !hasNoUsage(data) && (
        <>
          <section className="page__section">
            <div className="grid-page an__stats">
              <div className="an__stat">
                <StatBlock value={formatUsd(data.totalCost)} label="API-EQUIV COST" />
              </div>
              <div className="an__stat col-rule">
                <StatBlock value={formatTokens(totalTokens(data))} label="TOTAL TOKENS" size="md" />
              </div>
              <div className="an__stat col-rule">
                <StatBlock
                  value={formatPct(data.cacheEfficiency)}
                  label="CACHE EFFICIENCY"
                  size="md"
                />
              </div>
              <div className="an__stat col-rule">
                <StatBlock value={formatUsd(data.currentMonthCost)} label="THIS MONTH" size="md" />
              </div>
            </div>
            <p className="an__note micro-label">{data.planNote}</p>
          </section>

          <section className="page__section">
            <h2 className="micro-label an__heading">COST BY MODEL</h2>
            <Table headers={['MODEL', 'MESSAGES', 'INPUT', 'OUTPUT', 'CACHE R/W', 'COST']}>
              {data.models.map((m) => (
                <tr key={m.model}>
                  <td>
                    {/* Model id is opaque log text — text node only. */}
                    {m.model}
                    {!m.priced && <span className="an__est"> est.</span>}
                  </td>
                  <td>{m.messageCount.toLocaleString('en-US')}</td>
                  <td>{formatTokens(m.tokens.inputTokens)}</td>
                  <td>{formatTokens(m.tokens.outputTokens)}</td>
                  <td>
                    {formatTokens(m.tokens.cacheReadTokens)} /{' '}
                    {formatTokens(m.tokens.cacheCreationTokens)}
                  </td>
                  <td>{formatUsd(m.cost.total)}</td>
                </tr>
              ))}
            </Table>
            <p className="an__note micro-label">
              {data.pricingNote}
              {data.models.some((m) => !m.priced) &&
                ' Rows marked "est." use a fallback rate (unrecognized model).'}
            </p>
          </section>

          <section className="page__section">
            <div className="an__section-head">
              <h2 className="micro-label an__heading">DAILY COST TREND</h2>
              <span className="mono-data an__range">API-equivalent USD per UTC day</span>
            </div>
            <BarChart
              bars={dailyBars}
              ariaLabel="API-equivalent cost per day"
              axisLabels={sampleAxis((data.daily ?? []).map((d) => d.date))}
              peakLabel={`peak ${formatUsd(chartMax(dailyBars.map((b) => b.value)))}`}
            />
          </section>

          <section className="page__section">
            <div className="an__section-head">
              <h2 className="micro-label an__heading">HOURLY ACTIVITY</h2>
              <span className="mono-data an__range">messages per hour of day (UTC)</span>
            </div>
            <BarChart
              bars={hourlyBars}
              ariaLabel="messages by hour of day"
              axisLabels={['00', '06', '12', '18', '23']}
              peakLabel={`peak ${chartMax(hourlyBars.map((b) => b.value))} msgs`}
            />
          </section>

          {data.capped && (
            <section className="page__section">
              <p className="micro-label an__note">
                showing the most recent {data.sessionsScanned.toLocaleString('en-US')} of{' '}
                {data.sessionsTotal.toLocaleString('en-US')} sessions
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

/** Sum of the four token classes across the whole window. */
function totalTokens(a: AnalyticsResponse): number {
  const t = a.totals;
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}
