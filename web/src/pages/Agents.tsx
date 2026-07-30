import { useMemo } from 'react';
import { EmptyState, ListCard, ListRow, Pill, SourceBadge } from '../components/core/index.js';
import type { DetectedAgent } from '../api/types.js';
import { homeRel, pluralize } from '../lib/format.js';
import { routeHash } from '../routes.js';
import { useGlobalConfig, useReport } from '../state/index.js';
import { confidencePillTone, globalAgentEntries } from './agents/logic.js';
import './agents.css';

/** One agent list row: kind (linking to the detail page when project-scoped),
 *  scope badge, mono file list, confidence pill + file count. All values are
 *  report data — rendered as text nodes only. */
function AgentRow({
  agent,
  scope,
  root,
}: {
  agent: DetectedAgent;
  scope: 'project' | 'global';
  root?: string;
}) {
  const title =
    scope === 'project' ? (
      <a className="lr-link" href={routeHash({ name: 'agent', kind: agent.kind })}>
        {agent.kind}
      </a>
    ) : (
      // Global rows do not link: detail routes resolve against the project report.
      agent.kind
    );
  return (
    <ListRow
      title={title}
      badge={
        scope === 'project' ? (
          <SourceBadge scope="project" />
        ) : (
          <SourceBadge scope="global" detail={root !== undefined ? homeRel(root) : undefined} />
        )
      }
      sub={
        agent.files.length === 0 ? (
          'no config files'
        ) : (
          <span className="mono">{agent.files.join(' · ')}</span>
        )
      }
      trailing={
        <>
          <Pill tone={confidencePillTone(agent.confidence)}>{agent.confidence}</Pill>
          <span className="meta">{pluralize(agent.files.length, 'file')}</span>
        </>
      }
    />
  );
}

/** Detected-agent list (route `#/agents`). Reads the live report via
 *  `useReport()` and re-renders on every WS-driven refetch. Below the project
 *  card, inherited (~/.claude etc.) agents render per global dir with a
 *  provenance badge (E12); no global data ⇒ no extra card. */
export function Agents() {
  const { report, loading, error } = useReport();
  const { entries } = useGlobalConfig();
  const globalEntries = useMemo(() => globalAgentEntries(entries), [entries]);

  let body;
  if (!report && error) {
    body = <EmptyState title="Scan failed" instruction={error.message} />;
  } else if (!report) {
    body = <EmptyState instruction={loading ? 'scanning config …' : 'no report yet'} />;
  } else if (report.agents.length === 0) {
    body = <EmptyState instruction="no agents detected in this folder" />;
  } else {
    body = report.agents.map((agent) => (
      <AgentRow key={agent.kind} agent={agent} scope="project" />
    ));
  }

  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="page-sub">
            Agent runtimes detected in this folder, with the config files that identify them.
          </p>
        </div>
      </div>
      <ListCard head="PROJECT" headMeta={report ? String(report.agents.length) : undefined}>
        {body}
      </ListCard>
      {globalEntries.map((entry) => (
        <ListCard
          key={entry.root}
          head={`GLOBAL · ${homeRel(entry.root)}`}
          headMeta={String(entry.agents.length)}
        >
          {entry.agents.map((agent) => (
            <AgentRow
              key={`${entry.root}:${agent.kind}`}
              agent={agent}
              scope="global"
              root={entry.root}
            />
          ))}
        </ListCard>
      ))}
    </main>
  );
}
