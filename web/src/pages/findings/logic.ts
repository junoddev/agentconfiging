/**
 * Findings page — pure, DOM-free logic (bead c6p.5). Kept out of the component so
 * severity filtering, per-severity counts, and the applicable-fix predicate are
 * unit-testable over a plain array. The React page is a thin shell over these.
 *
 * Two `Severity` types meet here: the WIRE severity the API serves
 * ('error' | 'warning' | 'info') and the FindingRow's ROW severity
 * ('ok' | 'warn' | 'error'). `rowSeverity` bridges them.
 */

import type { GlobalEntry, ReportFinding, Severity } from '../../api/types.js';
import type { Severity as RowSeverity } from '../../components/core/index.js';

/** Severities in rail/report order — the order chips and tallies render in. */
export const SEVERITY_ORDER: readonly Severity[] = ['error', 'warning', 'info'];

/**
 * Wire severity → FindingRow's row-severity token (the 8px block color). `info`
 * maps to the calm `ok` tone; `warning` to `warn`; `error` stays `error`.
 */
export function rowSeverity(severity: Severity): RowSeverity {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'info':
      return 'ok';
  }
}

/**
 * A finding is machine-applicable when the server flagged a fix. The patch body
 * is stripped server-side (never serialized), so `hasFix` is the only signal the
 * client can trust — the real dry-run diff → /api/write flow is bead E5.
 */
export function hasApplicableFix(finding: Pick<ReportFinding, 'hasFix'>): boolean {
  return finding.hasFix === true;
}

/** Per-severity tallies over the FULL finding set (independent of the filter). */
export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
}

export function countBySeverity(findings: readonly ReportFinding[]): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/**
 * Keep the delivered (already severity-sorted) order; drop findings whose
 * severity is toggled off. An empty active set yields an empty list — filtering
 * hides bands honestly rather than silently falling back to "show all".
 */
export function filterFindings(
  findings: readonly ReportFinding[],
  active: ReadonlySet<Severity>,
): ReportFinding[] {
  return findings.filter((f) => active.has(f.severity));
}

/** Which config layer a finding came from. Drives the APPLY affordance. */
export type FindingLayer = 'project' | 'global';

/**
 * APPLY suppression predicate (E12): a fix is offered ONLY for project-layer
 * findings that carry a machine fix. Global (inherited) findings are never
 * applicable — /api/fix resolves finding ids against the project report and
 * cannot reach the global store BY DESIGN, so the button must never be offered.
 */
export function canApply(finding: Pick<ReportFinding, 'hasFix'>, layer: FindingLayer): boolean {
  return layer === 'project' && hasApplicableFix(finding);
}

/** One global finding annotated with the config dir it came from. */
export interface GlobalFindingRow {
  /** Real path of the global config dir (filesystem data — text nodes only). */
  root: string;
  finding: ReportFinding;
}

/** Flatten global entries into badge-ready finding rows, preserving entry
 *  order then each entry's (already severity-sorted) finding order. */
export function globalFindingRows(entries: readonly GlobalEntry[]): GlobalFindingRow[] {
  const rows: GlobalFindingRow[] = [];
  for (const entry of entries) {
    for (const finding of entry.findings) rows.push({ root: entry.root, finding });
  }
  return rows;
}

/** Terse severity tally for the global layer ('1 ERROR · 2 INFO'); empty string
 *  when the global layer has no findings. Rendered next to the GLOBAL heading
 *  so the layers' tallies stay visually distinct. */
export function globalTallyLine(findings: readonly ReportFinding[]): string {
  const counts = countBySeverity(findings);
  return SEVERITY_ORDER.filter((sev) => counts[sev] > 0)
    .map((sev) => severityCountLabel(sev, counts[sev]))
    .join(' · ');
}

/** Singular/plural label per severity ('info' does not pluralize). */
const SEVERITY_LABEL: Record<Severity, { one: string; many: string }> = {
  error: { one: 'ERROR', many: 'ERRORS' },
  warning: { one: 'WARNING', many: 'WARNINGS' },
  info: { one: 'INFO', many: 'INFO' },
};

/** Count chip / summary text in §7 voice: `3 ERRORS`, `1 WARNING`, `2 INFO`. */
export function severityCountLabel(severity: Severity, count: number): string {
  const label = SEVERITY_LABEL[severity];
  return `${count} ${count === 1 ? label.one : label.many}`;
}
