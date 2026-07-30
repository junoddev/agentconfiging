import { useMemo } from 'react';
import {
  EmptyState,
  FileChip,
  ListCard,
  ListRow,
  Pill,
  SourceBadge,
  Table,
} from '../components/core/index.js';
import type { DetectedAgent } from '../api/types.js';
import { homeRel, pluralize } from '../lib/format.js';
import { useGlobalConfig, useReport } from '../state/index.js';
import {
  artifactHref,
  confidencePillTone,
  extrasToRows,
  findAgent,
  findingsForAgent,
  globalFilesForKind,
  type GlobalKindGroup,
} from './agents/logic.js';
import { severityPillTone } from './findings/logic.js';
import './agents.css';

/** The resolved detail body for a known agent. */
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
  const extraRows = useMemo(() => extrasToRows(agent.extras), [agent.extras]);

  return (
    <>
      <div className="page-head">
        <div>
          {/* `kind` is report-derived text — rendered as a text node, never HTML. */}
          <h1>{agent.kind}</h1>
          <p className="page-sub">
            Detected from {pluralize(agent.files.length, 'config file')} in this folder.
          </p>
        </div>
        <div className="agent-detail__conf">
          <Pill tone={confidencePillTone(agent.confidence)}>{agent.confidence} confidence</Pill>
        </div>
      </div>

      <h2 className="micro-label agent-detail__caption">FILES</h2>
      {/* With global groups present the chips gain provenance headings:
          PROJECT first, then one GLOBAL · <dir> group per home config dir.
          Global chips deep-link by ABSOLUTE path (the file API's address for
          global files) — display stays entry-relative under the heading. */}
      {globalGroups.length > 0 && (
        <h3 className="agent-detail__filegroup">
          <SourceBadge scope="project" />
        </h3>
      )}
      {agent.files.length === 0 ? (
        <p className="meta">no config files</p>
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
        <p className="meta">no metadata</p>
      ) : (
        <Table headers={['KEY', 'VALUE']}>
          {extraRows.map((row) => (
            <tr key={row.key}>
              <td className="mono agent-extras__key">{row.key}</td>
              <td className="mono agent-extras__val">{row.value}</td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="micro-label agent-detail__caption">FINDINGS</h2>
      {findings.length === 0 ? (
        <p className="meta">no findings</p>
      ) : (
        <ListCard>
          {findings.map((finding) => (
            <ListRow
              key={finding.id}
              leading={<Pill tone={severityPillTone(finding.severity)}>{finding.severity}</Pill>}
              title={finding.title}
              sub={finding.suggestion !== undefined ? `→ ${finding.suggestion}` : undefined}
            />
          ))}
        </ListCard>
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
    body = <EmptyState title="Scan failed" instruction={error.message} />;
  } else if (!report) {
    body = <EmptyState instruction={loading ? 'scanning config …' : 'no report yet'} />;
  } else if (!agent) {
    body = <EmptyState instruction={`unknown agent · ${kind}`} />;
  } else {
    body = <AgentBody agent={agent} findings={findings} globalGroups={globalGroups} />;
  }

  return <main className="layout-main page">{body}</main>;
}
