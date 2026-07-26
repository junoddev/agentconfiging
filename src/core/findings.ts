/**
 * Finding shape per SPEC §3: `{id, severity, agent, title, detail, suggestion}`
 * with stable slug ids. Pure data + pure helpers — no I/O in src/core.
 */

export const SEVERITIES = ['error', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Machine-applicable fix payload (SPEC §4.1) — pure DATA. Nothing in
 * src/core applies fixes; an apply step (E5) consumes this.
 *
 * Patch semantics — full replacement, not unified diff: `patch` is the
 * COMPLETE new content of the file at `path` (manifest-relative). This was
 * chosen over unified-diff-style patches because analyzers already hold the
 * full file content from the manifest, replacement is trivially
 * deterministic to apply, and there is no drift/fuzz problem.
 */
export interface FixEdit {
  /** Manifest-relative path of the file to write. */
  path: string;
  /** Complete replacement content for the file. */
  patch: string;
}

export interface Fix {
  /** 'create-file': every edit path must not exist yet. 'replace-file': every edit path exists. */
  kind: 'create-file' | 'replace-file';
  edits: FixEdit[];
}

export interface Finding {
  id: string;
  severity: Severity;
  agent: string;
  title: string;
  detail: string;
  suggestion?: string;
  /** Optional machine-applicable fix — data only, applied elsewhere. */
  fix?: Fix;
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
