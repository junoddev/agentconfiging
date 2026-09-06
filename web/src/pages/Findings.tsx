import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Severity } from '../api/types.js';
import {
  Button,
  EmptyState,
  ListCard,
  ListRow,
  Pill,
  SourceBadge,
  useToast,
} from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import { routeHash } from '../routes.js';
import { useAppState, useGlobalConfig } from '../state/index.js';
import { WriteFlow, useWriteFlow } from '../write/index.js';
import {
  SEVERITY_ORDER,
  canApply,
  countBySeverity,
  filterFindings,
  globalFindingRows,
  globalTallyLine,
  scopeFindings,
  scopeGlobalFindingRows,
  severityCountLabel,
  severityPillTone,
} from './findings/logic.js';
import './findings.css';

/** Muted sub-line for one finding: `→ fix` + detail, mid-dot joined;
 *  undefined (no line at all) when the finding carries neither. */
function findingSub(f: { suggestion?: string; detail: string }): string | undefined {
  const parts: string[] = [];
  if (f.suggestion !== undefined) parts.push(`→ ${f.suggestion}`);
  if (f.detail !== '') parts.push(f.detail);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Findings page (route `#/findings`, bead c6p.5 + wmc.1, Console E13.4).
 * Renders the content-free report findings — already severity-sorted
 * server-side, order preserved — as list rows with severity pills and scope
 * badges, plus per-severity filter chips and one-click APPLY.
 *
 * APPLY drives the reusable write flow (bead wmc.1): clicking "Apply fix"
 * opens the mandatory diff preview (the fix's server-computed dry-run diff —
 * the client never holds the patch body, only sees `hasFix`), Commit applies
 * it through the guarded write path and refetches the report so the finding
 * drops out live (confirmed by a toast), Discard cancels. Errors (an
 * out-of-scope fix, a vanished finding, network) surface as terse in-panel
 * messages, never a crash.
 *
 * All finding strings (title / detail / suggestion) come from adversarially
 * parsed config and are rendered as TEXT NODES only — never as HTML.
 */
export function Findings() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <FindingsBody />;
}

function FindingsBody() {
  const { report, loading, error, activeAgent, agentScopeKind } = useAppState();
  const flow = useWriteFlow();
  const toast = useToast();
  // Findings are scoped to the effective picker selection, including a
  // runtime found only in GLOBAL. The project-only scope remains available to
  // pages that intentionally keep project data visible for global-only picks.
  const agentKind = activeAgent?.kind ?? agentScopeKind;
  // Inherited (machine-global) findings (E12), rendered in a GLOBAL list-card
  // with per-row provenance badges. APPLY is NEVER offered for them (see
  // `canApply` — /api/fix cannot reach the global store by design). Absent or
  // failed global data ⇒ zero rows ⇒ the page renders exactly as before.
  const { entries } = useGlobalConfig();
  const allGlobalRows = useMemo(() => globalFindingRows(entries), [entries]);
  const globalRows = useMemo(
    () => scopeGlobalFindingRows(allGlobalRows, agentKind),
    [allGlobalRows, agentKind],
  );

  // Which severity bands are visible. All on by default; a chip toggles its band.
  const [active, setActive] = useState<Set<Severity>>(() => new Set(SEVERITY_ORDER));
  // The finding whose APPLY diff-preview is currently expanded (or null). One
  // write flow is shared; opening a different finding supersedes the previous.
  const [openId, setOpenId] = useState<string | null>(null);

  const findings = useMemo(
    () => scopeFindings(report?.findings ?? [], agentKind),
    [report?.findings, agentKind],
  );

  // Every mutating action confirms via toast (§5): a committed fix announces
  // itself even as the refetched report drops the finding (and its panel).
  // Keyed on the phase alone — message/toast are stable companions of it.
  useEffect(() => {
    if (flow.phase === 'done') toast(flow.message ?? 'Fix applied');
  }, [flow.phase, flow.message, toast]);

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

  // Counts cover the complete currently scoped project + global set, so every
  // visible finding is represented by the same severity chip.
  const scopedFindings = useMemo(
    () => [...findings, ...globalRows.map((row) => row.finding)],
    [findings, globalRows],
  );
  const counts = useMemo(() => countBySeverity(scopedFindings), [scopedFindings]);
  const visible = useMemo(() => filterFindings(findings, active), [findings, active]);

  // Global layer: its own severity tally (the layers' tallies stay distinct)
  // and the same severity filter as the project rows.
  const globalTally = useMemo(
    () => globalTallyLine(globalRows.map((r) => r.finding)),
    [globalRows],
  );
  const visibleGlobal = useMemo(
    () => globalRows.filter((row) => active.has(row.finding.severity)),
    [globalRows, active],
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
        <EmptyState title="Scan failed" instruction={error.message} />
      </Frame>
    );
  }

  // First load, before the initial report has arrived. Live updates flow through
  // the hook, so this resolves on its own once the report lands.
  if (!report) {
    return (
      <Frame>
        <EmptyState instruction={loading ? 'scanning config …' : 'no report yet'} />
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
      {scopedFindings.length > 0 && (
        <div className="toolbar">
          <div className="chip-row" role="group" aria-label="filter by severity">
            {SEVERITY_ORDER.map((sev) => {
              const on = active.has(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  className={on ? 'chip active' : 'chip'}
                  aria-pressed={on}
                  onClick={() => toggle(sev)}
                >
                  {severityCountLabel(sev, counts[sev])}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <ListCard head="PROJECT" headMeta={String(findings.length)}>
        {findings.length === 0 ? (
          // Only reachable when global findings exist below (§7 voice, per layer).
          <EmptyState instruction="clean project config · nothing to fix" />
        ) : visible.length === 0 ? (
          <EmptyState instruction="no findings match the active severity filters" />
        ) : (
          visible.map((f) => (
            <div key={f.id} className="findings__row">
              <ListRow
                leading={<Pill tone={severityPillTone(f.severity)}>{f.severity}</Pill>}
                title={f.title}
                badge={<SourceBadge scope="project" />}
                sub={findingSub(f)}
                trailing={
                  <>
                    {/* Group the finding under its agent (route text — never HTML). */}
                    <a className="meta lr-link" href={routeHash({ name: 'agent', kind: f.agent })}>
                      {f.agent}
                    </a>
                    {canApply(f, 'project') && (
                      <Button label="Apply fix" onClick={() => onApply(f.id)} />
                    )}
                  </>
                }
              />
              {openId === f.id && (
                <div className="findings__flow">
                  <WriteFlow flow={flow} />
                </div>
              )}
            </div>
          ))
        )}
      </ListCard>

      {globalRows.length > 0 && (
        <ListCard head="GLOBAL" headMeta={globalTally}>
          {visibleGlobal.length === 0 ? (
            <EmptyState instruction="no global findings match the active severity filters" />
          ) : (
            visibleGlobal.map((row) => (
              // No apply action EVER for a global finding: apply-fix resolves
              // ids against the project report and cannot reach the global
              // store by design (see canApply in findings/logic).
              <ListRow
                key={`${row.root}:${row.finding.id}`}
                leading={
                  <Pill tone={severityPillTone(row.finding.severity)}>{row.finding.severity}</Pill>
                }
                title={row.finding.title}
                badge={<SourceBadge scope="global" detail={homeRel(row.root)} />}
                sub={findingSub(row.finding)}
                trailing={
                  // Agent kind as plain text: detail routes resolve against the
                  // project report, so a global-only kind must not link.
                  <span className="meta">{row.finding.agent}</span>
                }
              />
            ))
          )}
        </ListCard>
      )}
    </Frame>
  );
}

/** Shared page chassis so every state renders under the same page head. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="layout-main page">
      <div className="page-head">
        <div>
          <h1>Findings</h1>
          <p className="page-sub">
            Issues detected across this folder&apos;s agent config. Apply previews a dry-run diff —
            nothing is written without a commit.
          </p>
        </div>
      </div>
      {children}
    </main>
  );
}
