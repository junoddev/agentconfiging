/**
 * Finding shape per SPEC §3: `{id, severity, agent, title, detail, suggestion}`
 * with stable slug ids. Pure data + pure helpers — no I/O in src/core.
 */

export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  id: string;
  severity: Severity;
  agent: string;
  title: string;
  detail: string;
  suggestion?: string;
}

/** Stable slug id from arbitrary text: lowercase, alphanumerics, single dashes. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const severityRank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Sort findings by severity (errors first), then by id for a stable order. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id),
  );
}
