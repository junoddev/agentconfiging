/**
 * Findings page — pure, DOM-free logic (bead c6p.5). Kept out of the component so
 * severity filtering, per-severity counts, and the applicable-fix predicate are
 * unit-testable over a plain array. The React page is a thin shell over these.
 *
 * Two `Severity` types meet here: the WIRE severity the API serves
 * ('error' | 'warning' | 'info') and the FindingRow's ROW severity
 * ('ok' | 'warn' | 'error'). `rowSeverity` bridges them.
 */

import type { ReportFinding, Severity } from '../../api/types.js';
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
