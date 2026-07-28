/** Overview dashboard pure logic (docs/DESIGN.md §5–§7). DOM-free and
 *  React-free so the stat math, severity tallying, and waveform ConfigSource
 *  derivation are unit-testable in isolation; Overview.tsx stays a thin render.
 *
 *  Everything here is content-free by the same contract as the served report:
 *  it consumes only kinds, paths, severities, and counts. */

import type { Severity as BlockSeverity } from '../../components/core/index.js';
import type { ConfigSource } from '../../components/signal/index.js';
import { pluralize } from '../../lib/format.js';
import type {
  Confidence,
  DetectedAgent,
  GlobalEntry,
  Report,
  ReportFinding,
} from '../../api/types.js';

/** Findings tallied by severity — the summary numbers the dashboard shows. */
export interface SeverityTally {
  error: number;
  warning: number;
  info: number;
}

/** The stat-block figures across the top of the overview. */
export interface OverviewStats {
  agentCount: number;
  fileCount: number;
  tally: SeverityTally;
}

/** Derived, render-ready data for one agent's SignalStrip. */
export interface AgentSignal {
  /** Display kind — the runtime id in terse caps (§7). */
  kind: string;
  /** Waveform fingerprint sources. Deterministic in the agent's files. */
  sources: ConfigSource[];
  /** Detector confidence mapped to a [0, 1] VU level. */
  confidence: number;
  fileCount: number;
}

/** Qualitative detector confidence → VU meter level in [0, 1]. `high` sits in
 *  the meter's warn range (warnFrom 0.8) so a strong lock reads at full scale. */
const CONFIDENCE_LEVEL: Record<Confidence, number> = {
  low: 0.35,
  medium: 0.65,
  high: 0.95,
};

export function confidenceLevel(confidence: Confidence): number {
  return CONFIDENCE_LEVEL[confidence];
}

/** Report severity → the FindingRow's 3-tone severity block. `info` maps to the
 *  `ok` (signal) tone — the whole severity palette is exactly these three. */
export function severityToBlock(severity: ReportFinding['severity']): BlockSeverity {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'info':
      return 'ok';
  }
}

/** Count findings by severity. */
export function tallyFindings(findings: readonly ReportFinding[]): SeverityTally {
  const tally: SeverityTally = { error: 0, warning: 0, info: 0 };
  for (const f of findings) tally[f.severity] += 1;
  return tally;
}

/** Compute every stat-block figure from a report. */
export function computeStats(report: Report): OverviewStats {
  return {
    agentCount: report.agents.length,
    fileCount: report.stats.fileCount,
    tally: tallyFindings(report.findings),
  };
}

/** Derive a deterministic ConfigSource set for an agent's waveform.
 *
 *  The served report carries only file PATHS per agent (no per-file size or
 *  hash), so we fold the path itself into a stable `size` — the fingerprint's
 *  determinism contract only needs the same files to yield the same trace and
 *  a changed file set to move it, which path-derived sizes satisfy. */
export function deriveAgentSources(agent: DetectedAgent): ConfigSource[] {
  return agent.files.map((path) => ({ path, size: path.length }));
}

/** Terse caps display for an agent kind, e.g. 'claude-code' → 'CLAUDE-CODE'. */
export function displayKind(kind: string): string {
  return kind.toUpperCase();
}

/** Build render-ready SignalStrip data for every detected agent. */
export function buildAgentSignals(report: Report): AgentSignal[] {
  return report.agents.map((agent) => ({
    kind: displayKind(agent.kind),
    sources: deriveAgentSources(agent),
    confidence: confidenceLevel(agent.confidence),
    fileCount: agent.files.length,
  }));
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

/** One-line inherited-config presence summary (E12, DESIGN §5–§7 restraint):
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

/** One-line severity summary in the §7 voice, e.g. "1 ERROR · 3 WARNINGS".
 *  Only non-zero severities appear; an all-clear report reads "SIGNAL CLEAN". */
export function severitySummary(tally: SeverityTally): string {
  const parts: string[] = [];
  if (tally.error > 0) parts.push(pluralize(tally.error, 'error').toUpperCase());
  if (tally.warning > 0) parts.push(pluralize(tally.warning, 'warning').toUpperCase());
  if (tally.info > 0) parts.push(pluralize(tally.info, 'info', 'info').toUpperCase());
  return parts.length === 0 ? 'SIGNAL CLEAN' : parts.join(' · ');
}
