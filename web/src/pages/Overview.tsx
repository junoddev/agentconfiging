import { useMemo, type ReactNode } from 'react';
import {
  EmptyState,
  ListCard,
  ListRow,
  Pill,
  SourceBadge,
  StatBlock,
} from '../components/core/index.js';
import { homeRel, pluralize } from '../lib/format.js';
import { routeHash } from '../routes.js';
import { useGlobalConfig, useReport } from '../state/index.js';
import { confidencePillTone } from './agents/logic.js';
import { severityPillTone } from './findings/logic.js';
import {
  computeStats,
  configSourceRows,
  healthItems,
  inheritedSummary,
  severitySummary,
  topFindings,
} from './overview/stats.js';
import './overview.css';

/** Overview (route `#/`, opendesign/DESIGN.md + reference rOverview): the
 *  read-only landing view of the current instance's report — wayfinding tiles,
 *  a CONFIG SOURCES table with provenance badges, a health card, and terse
 *  agent/finding summaries. Re-renders from the app-state hook, so a WS-driven
 *  refetch updates it automatically. All report strings are adversarial parsed
 *  config — rendered as text nodes only. */
export function Overview() {
  const { report, loading, error } = useReport();
  // Inherited (machine-global) presence (E12). Absent global data ⇒ empty
  // entries ⇒ the page renders exactly as before; a global load failure only
  // ever leaves `entries` empty and never touches `error`.
  const { entries: globalEntries } = useGlobalConfig();
  const inherited = inheritedSummary(globalEntries);

  const stats = useMemo(() => (report ? computeStats(report) : undefined), [report]);
  const sources = useMemo(
    () => (report ? configSourceRows(report, globalEntries) : []),
    [report, globalEntries],
  );
  const summary = useMemo(() => (report ? topFindings(report.findings) : []), [report]);

  if (error && !report) {
    return (
      <Frame>
        <EmptyState title="Scan failed" instruction={error.message} />
      </Frame>
    );
  }

  if (!report || !stats) {
    return (
      <Frame>
        <EmptyState instruction={loading ? 'scanning config …' : 'no report yet'} />
      </Frame>
    );
  }

  const health = healthItems(stats);

  return (
    <Frame>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="page-sub">
            Agent config detected in this folder — project scope first, inherited global config
            below it.
          </p>
        </div>
      </div>

      <div className="tile-row">
        <StatBlock
          value={stats.agentCount}
          label="Agents"
          onClick={() => {
            window.location.hash = '#/agents';
          }}
        />
        <StatBlock
          value={stats.tally.error}
          label="Errors"
          onClick={() => {
            window.location.hash = '#/findings';
          }}
        />
        <StatBlock
          value={stats.tally.warning}
          label="Warnings"
          onClick={() => {
            window.location.hash = '#/findings';
          }}
        />
        <StatBlock
          value={stats.fileCount}
          label="Config files"
          onClick={() => {
            window.location.hash = '#/artifacts';
          }}
        />
      </div>

      <div className="grid-2 overview__grid">
        <div className="table-card">
          <div className="lc-head">
            <span>CONFIG SOURCES</span>
            <span>{pluralize(sources.length, 'file')}</span>
          </div>
          {sources.length === 0 ? (
            <EmptyState instruction="no config files detected" />
          ) : (
            <table className="ds-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Scope</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((row) => (
                  <tr key={`${row.root ?? ''}:${row.agent}:${row.path}`}>
                    <td className="mono">{row.path}</td>
                    <td className="mono">{row.agent}</td>
                    <td>
                      {row.scope === 'project' ? (
                        <SourceBadge scope="project" />
                      ) : (
                        <SourceBadge scope="global" detail={homeRel(row.root ?? '')} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card health">
          <h2>Health</h2>
          <ul>
            {health.map((item) => (
              <li key={item.text}>
                <span className={item.ok ? 'h-ok' : 'h-warn'} aria-hidden="true">
                  {item.ok ? '✓' : '▲'}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          {inherited !== undefined && (
            <a className="meta overview__inherited" href="#/agents">
              {inherited}
            </a>
          )}
        </div>
      </div>

      <ListCard head="AGENTS" headMeta={String(report.agents.length)}>
        {report.agents.length === 0 ? (
          <EmptyState instruction="no agents detected in this folder" />
        ) : (
          report.agents.map((agent) => (
            <ListRow
              key={agent.kind}
              title={
                <a className="lr-link" href={routeHash({ name: 'agent', kind: agent.kind })}>
                  {agent.kind}
                </a>
              }
              badge={<SourceBadge scope="project" />}
              sub={<span className="mono">{agent.files.join(' · ')}</span>}
              trailing={
                <>
                  <Pill tone={confidencePillTone(agent.confidence)}>{agent.confidence}</Pill>
                  <span className="meta">{pluralize(agent.files.length, 'file')}</span>
                </>
              }
            />
          ))
        )}
      </ListCard>

      <ListCard
        head="FINDINGS"
        headMeta={
          <span>
            {severitySummary(stats.tally)} · <a href="#/findings">view all</a>
          </span>
        }
      >
        {summary.length === 0 ? (
          <EmptyState instruction="clean config · nothing to fix" />
        ) : (
          summary.map((finding) => (
            <ListRow
              key={finding.id}
              leading={<Pill tone={severityPillTone(finding.severity)}>{finding.severity}</Pill>}
              title={finding.title}
              sub={finding.suggestion !== undefined ? `→ ${finding.suggestion}` : undefined}
            />
          ))
        )}
      </ListCard>
    </Frame>
  );
}

/** Shared page chassis so every state renders in the same main shell. */
function Frame({ children }: { children: ReactNode }) {
  return <main className="layout-main page overview">{children}</main>;
}
