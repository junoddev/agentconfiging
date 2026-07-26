import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, FindingRow, SignalStrip, StatBlock } from '../components/core/index.js';
import { SweepOverlay } from '../components/signal/index.js';
import { useReport } from '../state/index.js';
import type { AppError } from '../state/index.js';
import {
  buildAgentSignals,
  computeStats,
  severitySummary,
  severityToBlock,
  topFindings,
} from './overview/stats.js';
import './overview.css';

/** Terse error panel (§7 voice) — an honest dead-signal state, never a crash.
 *  `unauthorized` is handled by the shell, so this covers network/unknown. */
function ErrorPanel({ error }: { error: AppError }) {
  return (
    <div className="surface overview__error">
      <div className="numeral-giant numeral-giant--sm">SIGNAL LOST</div>
      <p className="mono-data overview__error-msg">{error.message}</p>
    </div>
  );
}

/** Overview dashboard (rail `01 SIGNAL`, DESIGN §5–§7): the read-only landing
 *  view of the current instance's report — stat blocks, one SignalStrip per
 *  detected agent, and a findings summary. Re-renders from the app-state hook,
 *  so a WS-driven refetch updates it automatically. */
export function Overview() {
  const { report, loading, error } = useReport();

  // Run one rescan sweep on each loading rising edge (a refetch over an existing
  // report). No skeleton loaders (§9) — the sweep is the loading affordance.
  const [sweepKey, setSweepKey] = useState(0);
  const wasLoading = useRef(false);
  useEffect(() => {
    if (loading && !wasLoading.current) setSweepKey((k) => k + 1);
    wasLoading.current = loading;
  }, [loading]);

  // Waveform compares `sources` by reference; deriving strip data once per
  // report keeps those arrays stable across unrelated re-renders (ws state,
  // theme) so the traces don't restart. Key the waveform-bearing signals on the
  // agent kind+file set so a refetch that leaves agents unchanged keeps a stable
  // sources reference (matches the Agents/AgentDetail pages' memo strategy).
  const agentsKey = report
    ? report.agents.map((a) => `${a.kind}:${a.files.join(',')}`).join('|')
    : '';
  // Memo intentionally keyed on agentsKey (the kind+file set), not `report`, so
  // a refetch with unchanged agents keeps a stable sources reference.
  const signals = useMemo(() => (report ? buildAgentSignals(report) : []), [agentsKey]);
  const stats = useMemo(() => (report ? computeStats(report) : undefined), [report]);
  const summary = useMemo(() => (report ? topFindings(report.findings) : []), [report]);

  if (error) {
    return (
      <main className="layout-main page">
        <section className="page__section">
          <ErrorPanel error={error} />
        </section>
      </main>
    );
  }

  if (!report || !stats) {
    return (
      <main className="layout-main page">
        <section className="page__section">
          <p className="micro-label overview__acquiring">
            {loading ? 'ACQUIRING SIGNAL' : 'NO REPORT'}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="layout-main page">
      <section className="page__section sweep-panel">
        <SweepOverlay sweepKey={sweepKey} />
        <div className="grid-page overview__stats">
          <div className="overview__stat">
            <StatBlock value={stats.agentCount} label="AGENTS" />
          </div>
          <div className="overview__stat col-rule">
            <StatBlock value={stats.tally.error} label="ERRORS" size="md" />
          </div>
          <div className="overview__stat col-rule">
            <StatBlock value={stats.tally.warning} label="WARNINGS" size="md" />
          </div>
          <div className="overview__stat col-rule">
            <StatBlock value={stats.fileCount} label="ARTIFACTS" size="md" />
          </div>
        </div>
      </section>

      <section className="page__section">
        <h2 className="micro-label overview__heading">AGENTS</h2>
        {signals.length === 0 ? (
          <EmptyState instruction="add agent config to this folder to begin watching" />
        ) : (
          signals.map((signal) => (
            <SignalStrip
              key={signal.kind}
              kind={signal.kind}
              sources={signal.sources}
              confidence={signal.confidence}
              fileCount={signal.fileCount}
            />
          ))
        )}
      </section>

      <section className="page__section">
        <div className="overview__findings-head">
          <h2 className="micro-label overview__heading">FINDINGS</h2>
          <span className="mono-data overview__summary">{severitySummary(stats.tally)}</span>
          <a className="mono-data overview__link" href="#/findings">
            → FINDINGS
          </a>
        </div>
        {summary.length === 0 ? (
          <p className="micro-label overview__acquiring">SIGNAL CLEAN</p>
        ) : (
          summary.map((finding, i) => (
            <FindingRow
              key={finding.id}
              index={i + 1}
              severity={severityToBlock(finding.severity)}
              title={finding.title}
              fix={finding.suggestion}
            />
          ))
        )}
      </section>
    </main>
  );
}
