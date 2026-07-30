/** Overview page pure logic (opendesign/DESIGN.md §5–§7). DOM-free and
 *  React-free so the stat math, severity tallying, and config-source/health
 *  derivations are unit-testable in isolation; Overview.tsx stays a thin
 *  render.
 *
 *  Everything here is content-free by the same contract as the served report:
 *  it consumes only kinds, paths, severities, and counts. */

import { pluralize } from '../../lib/format.js';
import type { GlobalEntry, Report, ReportFinding } from '../../api/types.js';

/** Findings tallied by severity — the summary numbers the overview shows. */
export interface SeverityTally {
  error: number;
  warning: number;
  info: number;
}

/** The wayfinding-tile figures across the top of the overview. */
export interface OverviewStats {
  agentCount: number;
  fileCount: number;
  tally: SeverityTally;
}

/** Count findings by severity. */
export function tallyFindings(findings: readonly ReportFinding[]): SeverityTally {
  const tally: SeverityTally = { error: 0, warning: 0, info: 0 };
  for (const f of findings) tally[f.severity] += 1;
  return tally;
}

/** Compute every tile figure from a report. */
export function computeStats(report: Report): OverviewStats {
  return {
    agentCount: report.agents.length,
    fileCount: report.stats.fileCount,
    tally: tallyFindings(report.findings),
  };
}

/** One CONFIG SOURCES table row: a detected config file with its provenance
 *  (§7: provenance is never implicit — every row wears a scope badge). */
export interface ConfigSourceRow {
  /** Project-relative (project scope) or entry-relative (global scope) path. */
  path: string;
  /** Agent kind the file identifies (report data — text nodes only). */
  agent: string;
  scope: 'project' | 'global';
  /** Global config dir root, set only for global rows. */
  root?: string;
}

/** Flatten project + inherited (machine-global) config files into table rows:
 *  project files first (report order), then each global dir's files. */
export function configSourceRows(
  report: Report,
  entries: readonly GlobalEntry[],
): ConfigSourceRow[] {
  const rows: ConfigSourceRow[] = [];
  for (const agent of report.agents) {
    for (const path of agent.files) rows.push({ path, agent: agent.kind, scope: 'project' });
  }
  for (const entry of entries) {
    for (const agent of entry.agents) {
      for (const path of agent.files) {
        rows.push({ path, agent: agent.kind, scope: 'global', root: entry.root });
      }
    }
  }
  return rows;
}

/** One HEALTH card line: ✓ (ok) or ▲ (warn) + a factual statement. */
export interface HealthItem {
  ok: boolean;
  text: string;
}

/** Derive the health list from the stats — honest statements only, no invented
 *  metrics (§8): agent detection plus the error/warning/info tallies. */
export function healthItems(stats: OverviewStats): HealthItem[] {
  const items: HealthItem[] = [
    {
      ok: stats.agentCount > 0,
      text:
        stats.agentCount > 0
          ? `${pluralize(stats.agentCount, 'agent')} detected`
          : 'no agents detected in this folder',
    },
    {
      ok: stats.tally.error === 0,
      text: stats.tally.error === 0 ? 'no errors' : pluralize(stats.tally.error, 'error'),
    },
    {
      ok: stats.tally.warning === 0,
      text: stats.tally.warning === 0 ? 'no warnings' : pluralize(stats.tally.warning, 'warning'),
    },
  ];
  if (stats.tally.info > 0) {
    items.push({
      ok: true,
      text: `${stats.tally.info} info ${stats.tally.info === 1 ? 'note' : 'notes'}`,
    });
  }
  return items;
}

/** Severity ordering for the summary: errors first, then warnings, then info. */
const SEVERITY_RANK: Record<ReportFinding['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** The most important few findings for the summary: sorted by severity (stable
 *  within a severity, preserving the report's own ordering) and capped. */
export function topFindings(findings: readonly ReportFinding[], limit = 4): ReportFinding[] {
  return [...findings]
    .map((finding, index) => ({ finding, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.finding);
}

/** One-line inherited-config presence summary (E12, DESIGN §7 restraint):
 *  `INHERITED · 2 GLOBAL DIRS · 3 AGENTS · 4 FINDINGS`. Counts span every
 *  successfully scanned global dir. `undefined` when there is no global data —
 *  the Overview then renders exactly as before (invariant: absent = no-op). */
export function inheritedSummary(entries: readonly GlobalEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  const agents = entries.reduce((n, e) => n + e.agents.length, 0);
  const findings = entries.reduce((n, e) => n + e.findings.length, 0);
  const parts = [
    pluralize(entries.length, 'global dir'),
    pluralize(agents, 'agent'),
    pluralize(findings, 'finding'),
  ];
  return `INHERITED · ${parts.join(' · ').toUpperCase()}`;
}

/** One-line severity summary in the §7 voice, e.g. "1 error · 3 warnings".
 *  Only non-zero severities appear; an all-clear report reads "clean". */
export function severitySummary(tally: SeverityTally): string {
  const parts: string[] = [];
  if (tally.error > 0) parts.push(pluralize(tally.error, 'error'));
  if (tally.warning > 0) parts.push(pluralize(tally.warning, 'warning'));
  if (tally.info > 0) parts.push(pluralize(tally.info, 'info', 'info'));
  return parts.length === 0 ? 'clean' : parts.join(' · ');
}
