import { useMemo, useState, type ReactNode } from 'react';
import type { Severity } from '../api/types.js';
import { EmptyState, FindingRow, SourceBadge, severityClass } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { routeHash } from '../routes.js';
import { useGlobalConfig, useReport } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import {
  SEVERITY_ORDER,
  canApply,
  countBySeverity,
  filterFindings,
  globalFindingRows,
  globalTallyLine,
  rowSeverity,
  severityCountLabel,
} from './findings/logic.js';
import './findings.css';

/**
 * Findings page (rail `03 FINDINGS`, route `#/findings`, bead c6p.5 + wmc.1).
 * Renders the content-free report findings — already severity-sorted server-side,
 * order preserved — as timetable FindingRows, with per-severity filter chips and
 * one-click APPLY.
 *
 * APPLY drives the reusable write flow (bead wmc.1): clicking [APPLY] opens the
 * mandatory DIFF PREVIEW (the fix's server-computed dry-run diff — the client
 * never holds the patch body, only sees `hasFix`), [COMMIT] applies it through
 * the guarded write path and refetches the report so the finding drops out live,
 * [DISCARD] cancels. Errors (an out-of-scope fix, a vanished finding, network)
 * surface as terse in-panel messages, never a crash.
 *
 * All finding strings (title / detail / suggestion) come from adversarially
 * parsed config and are rendered as TEXT NODES only — never as HTML.
 */
export function Findings() {
  const { report, loading, error } = useReport();
  const flow = useWriteFlow();
  // Inherited (machine-global) findings (E12), rendered under a GLOBAL group
  // with per-row provenance badges. APPLY is NEVER offered for them (see
  // `canApply` — /api/fix cannot reach the global store by design). Absent or
  // failed global data ⇒ zero rows ⇒ the page renders exactly as before.
  const { entries } = useGlobalConfig();
  const globalRows = useMemo(() => globalFindingRows(entries), [entries]);

  // Which severity bands are visible. All on by default; a chip toggles its band.
  const [active, setActive] = useState<Set<Severity>>(() => new Set(SEVERITY_ORDER));
  // The finding whose APPLY diff-preview is currently expanded (or null). One
  // write flow is shared; opening a different finding supersedes the previous.
  const [openId, setOpenId] = useState<string | null>(null);

  const findings = report?.findings ?? [];

  function onApply(id: string) {
    // Toggle: re-clicking the open finding discards its preview.
    if (openId === id) {
      flow.cancel();
      setOpenId(null);
      return;
    }
    setOpenId(id);
    flow.begin({ kind: 'fix', findingId: id });
  }

  // Counts are over the FULL set so the chips report totals, not the filtered view.
  const counts = useMemo(() => countBySeverity(findings), [findings]);
  const visible = useMemo(() => filterFindings(findings, active), [findings, active]);
  // Stable 1-based timetable index per finding id — filtering never renumbers.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    findings.forEach((f, i) => map.set(f.id, i + 1));
    return map;
  }, [findings]);

  // Global layer: its own severity tally (the layers' tallies stay distinct)
  // and the same severity filter as the project rows. Indexes continue the
  // timetable after the project set and are stable under filtering.
  const globalTally = useMemo(
    () => globalTallyLine(globalRows.map((r) => r.finding)),
    [globalRows],
  );
  const visibleGlobal = useMemo(
    () =>
      globalRows
        .map((row, i) => ({ ...row, index: findings.length + i + 1 }))
        .filter((row) => active.has(row.finding.severity)),
    [globalRows, findings.length, active],
  );

  function toggle(sev: Severity) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  }

  // Fetch error before any report is available (unauthorized is handled by the shell).
  if (error && !report) {
    return (
      <Frame>
        <EmptyState instruction={error.message} />
      </Frame>
    );
  }

  // First load, before the initial report has arrived. Live updates flow through
  // the hook, so this resolves on its own once the report lands.
  if (!report) {
    return (
      <Frame>
        <EmptyState
          title="ACQUIRING"
          instruction={loading ? 'scanning config …' : 'awaiting report'}
        />
      </Frame>
    );
  }

  // Clean config across BOTH layers — the affirmative empty state (§7 voice).
  if (findings.length === 0 && globalRows.length === 0) {
    return (
      <Frame>
        <EmptyState instruction="clean config · nothing to fix" />
      </Frame>
    );
  }

  return (
    <Frame>
      {findings.length > 0 && (
        <div className="findings__filters" role="group" aria-label="filter by severity">
          {SEVERITY_ORDER.map((sev) => {
            const on = active.has(sev);
            return (
              <button
                key={sev}
                type="button"
                className="findings__chip"
                aria-pressed={on}
                onClick={() => toggle(sev)}
              >
                <span className={`sev ${severityClass(rowSeverity(sev))}`} aria-hidden="true" />
                <span className="mono-data">{severityCountLabel(sev, counts[sev])}</span>
              </button>
            );
          })}
        </div>
      )}

      {findings.length === 0 ? (
        // Only reachable when global findings exist below (§7 voice, per layer).
        <EmptyState instruction="clean project config · nothing to fix" />
      ) : visible.length === 0 ? (
        <EmptyState instruction="no findings match the active filters" />
      ) : (
        <ol className="findings__list">
          {visible.map((f) => (
            <li key={f.id} className="findings__item">
              <FindingRow
                index={indexById.get(f.id) ?? 0}
                severity={rowSeverity(f.severity)}
                title={f.title}
                fix={f.suggestion}
                onApply={canApply(f, 'project') ? () => onApply(f.id) : undefined}
              />
              <div className="findings__meta">
                {/* Group the finding under its agent (route text — never HTML). */}
                <a
                  className="findings__agent mono-data"
                  href={routeHash({ name: 'agent', kind: f.agent })}
                >
                  {f.agent}
                </a>
                {f.detail !== '' && <span className="findings__detail">{f.detail}</span>}
              </div>
              {openId === f.id && <WriteFlow flow={flow} />}
            </li>
          ))}
        </ol>
      )}

      {globalRows.length > 0 && (
        <div className="findings__global">
          <div className="findings__global-head">
            <h2 className="micro-label">GLOBAL</h2>
            <span className="mono-data findings__global-tally">{globalTally}</span>
          </div>
          <ol className="findings__list">
            {visibleGlobal.map((row) => (
              <li key={`${row.root}:${row.finding.id}`} className="findings__item">
                {/* No onApply EVER for a global finding: apply-fix resolves ids
                    against the project report and cannot reach the global store
                    by design (see canApply in findings/logic). */}
                <FindingRow
                  index={row.index}
                  severity={rowSeverity(row.finding.severity)}
                  title={row.finding.title}
                  fix={row.finding.suggestion}
                />
                <div className="findings__meta">
                  <SourceBadge scope="global" detail={homeRel(row.root)} />
                  {/* Agent kind as plain text: detail routes resolve against the
                      project report, so a global-only kind must not link. */}
                  <span className="mono-data">{row.finding.agent}</span>
                  {row.finding.detail !== '' && (
                    <span className="findings__detail">{row.finding.detail}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Frame>
  );
}

/** Shared page chassis so every state renders in the same main/section shell. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="layout-main page">
      <section className="page__section">{children}</section>
    </main>
  );
}
