import { useMemo } from 'react';
import { EmptyState, FileChip, FindingRow, Table } from '../components/core/index.js';
import { VuMeter, Waveform } from '../components/signal/index.js';
import type { DetectedAgent } from '../api/types.js';
import { useReport } from '../state/index.js';
import {
  artifactHref,
  confidenceLevel,
  extrasToRows,
  findAgent,
  findingsForAgent,
  toConfigSources,
  toRowSeverity,
} from './agents/logic.js';
import './agents.css';

/** The resolved detail body for a known agent. Split out so the waveform
 *  sources memo keys on the agent's file list, not on the page-level report
 *  object (which is a fresh reference after every WS refetch). */
function AgentBody({
  agent,
  findings,
}: {
  agent: DetectedAgent;
  findings: ReturnType<typeof findingsForAgent>;
}) {
  const filesKey = agent.files.join(' ');
  const sources = useMemo(() => toConfigSources(agent.files), [filesKey]);
  const extraRows = useMemo(() => extrasToRows(agent.extras), [agent.extras]);

  return (
    <>
      <div className="agent-detail__head">
        {/* `kind` is report-derived text — rendered as a text node, never HTML. */}
        <span className="agent-detail__kind">{agent.kind.toUpperCase()}</span>
        <span className="agent-detail__conf">
          <span className="micro-label">{agent.confidence.toUpperCase()}</span>
          <VuMeter level={confidenceLevel(agent.confidence)} label={`${agent.kind} confidence`} />
        </span>
      </div>

      <div className="agent-detail__wave">
        <Waveform sources={sources} label={`${agent.kind} fingerprint`} />
      </div>

      <h2 className="micro-label agent-detail__caption">FILES</h2>
      {agent.files.length === 0 ? (
        <p className="micro-label">no config files</p>
      ) : (
        <div className="agent-detail__chips">
          {agent.files.map((path) => (
            <FileChip
              key={path}
              path={path}
              onClick={() => {
                window.location.hash = artifactHref(path);
              }}
            />
          ))}
        </div>
      )}

      <h2 className="micro-label agent-detail__caption">METADATA</h2>
      {extraRows.length === 0 ? (
        <p className="micro-label">no metadata</p>
      ) : (
        <Table headers={['KEY', 'VALUE']}>
          {extraRows.map((row) => (
            <tr key={row.key}>
              <td className="agent-extras__key">{row.key}</td>
              <td className="agent-extras__val">{row.value}</td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="micro-label agent-detail__caption">FINDINGS</h2>
      {findings.length === 0 ? (
        <p className="micro-label">no findings</p>
      ) : (
        findings.map((finding, i) => (
          <FindingRow
            key={finding.id}
            index={i + 1}
            severity={toRowSeverity(finding.severity)}
            title={finding.title}
            fix={finding.suggestion}
          />
        ))
      )}
    </>
  );
}

/** Per-runtime detail (route `#/agent/:kind`). Reads the live report via
 *  `useReport()`; an unknown kind (or an empty/failed report) resolves to an
 *  honest empty state rather than a crash. */
export function AgentDetail({ kind }: { kind: string }) {
  const { report, loading, error } = useReport();
  const agent = findAgent(report, kind);
  const findings = findingsForAgent(report, kind);

  let body;
  if (!report && error) {
    body = <EmptyState title="NO SIGNAL" instruction={`scan failed · ${error.message}`} />;
  } else if (!report) {
    body = <EmptyState title="SCANNING" instruction={loading ? 'acquiring signal' : 'no report'} />;
  } else if (!agent) {
    body = <EmptyState title="NO SIGNAL" instruction={`unknown agent · ${kind}`} />;
  } else {
    body = <AgentBody agent={agent} findings={findings} />;
  }

  return (
    <main className="layout-main page">
      <section className="page__section">{body}</section>
    </main>
  );
}
