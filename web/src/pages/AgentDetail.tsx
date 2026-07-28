import { useMemo } from 'react';
import { EmptyState, FileChip, FindingRow, SourceBadge, Table } from '../components/core/index.js';
import { VuMeter, Waveform } from '../components/signal/index.js';
import type { DetectedAgent } from '../api/types.js';
import { homeRel } from '../lib/format.js';
import { useGlobalConfig, useReport } from '../state/index.js';
import {
  artifactHref,
  confidenceLevel,
  extrasToRows,
  findAgent,
  findingsForAgent,
  toConfigSources,
  toRowSeverity,
  globalFilesForKind,
  type GlobalKindGroup,
} from './agents/logic.js';
import './agents.css';

/** The resolved detail body for a known agent. Split out so the waveform
 *  sources memo keys on the agent's file list, not on the page-level report
 *  object (which is a fresh reference after every WS refetch). */
function AgentBody({
  agent,
  findings,
  globalGroups,
}: {
  agent: DetectedAgent;
  findings: ReturnType<typeof findingsForAgent>;
  /** Per-global-dir files for this SAME kind (E12); empty ⇒ ungrouped chips,
   *  exactly as before global data existed. */
  globalGroups: GlobalKindGroup[];
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
      {/* With global groups present the chips gain provenance micro-headings:
          PROJECT first, then one GLOBAL · <dir> group per home config dir.
          Global chips deep-link by ABSOLUTE path (the file API's address for
          global files) — display stays entry-relative under the heading. */}
      {globalGroups.length > 0 && <h3 className="micro-label agent-detail__filegroup">PROJECT</h3>}
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
      {globalGroups.map((group) => (
        <div key={group.root}>
          <h3 className="agent-detail__filegroup">
            <SourceBadge scope="global" detail={homeRel(group.root)} />
          </h3>
          <div className="agent-detail__chips">
            {group.files.map((file) => (
              <FileChip
                key={file.abs}
                path={file.rel}
                onClick={() => {
                  window.location.hash = artifactHref(file.abs);
                }}
              />
            ))}
          </div>
        </div>
      ))}

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
  // Inherited files for the same kind (E12). A missing/failed global report
  // yields [] — the detail renders exactly as it did without global data.
  const { entries } = useGlobalConfig();
  const globalGroups = useMemo(() => globalFilesForKind(entries, kind), [entries, kind]);

  let body;
  if (!report && error) {
    body = <EmptyState title="NO SIGNAL" instruction={`scan failed · ${error.message}`} />;
  } else if (!report) {
    body = <EmptyState title="SCANNING" instruction={loading ? 'acquiring signal' : 'no report'} />;
  } else if (!agent) {
    body = <EmptyState title="NO SIGNAL" instruction={`unknown agent · ${kind}`} />;
  } else {
    body = <AgentBody agent={agent} findings={findings} globalGroups={globalGroups} />;
  }

  return (
    <main className="layout-main page">
      <section className="page__section">{body}</section>
    </main>
  );
}
