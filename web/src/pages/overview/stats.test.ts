import { describe, expect, it } from 'vitest';
import type { DetectedAgent, GlobalEntry, Report, ReportFinding } from '../../api/types.js';
import {
  buildAgentSignals,
  computeStats,
  confidenceLevel,
  deriveAgentSources,
  displayKind,
  inheritedSummary,
  severitySummary,
  severityToBlock,
  tallyFindings,
  topFindings,
} from './stats.js';

const agent = (over: Partial<DetectedAgent> = {}): DetectedAgent => ({
  kind: 'claude-code',
  confidence: 'high',
  files: ['CLAUDE.md', '.claude/settings.json'],
  extras: {},
  ...over,
});

const finding = (over: Partial<ReportFinding> = {}): ReportFinding => ({
  id: 'f',
  severity: 'warning',
  agent: 'claude-code',
  title: 'do the thing',
  detail: 'because',
  ...over,
});

const report = (over: Partial<Report> = {}): Report => ({
  version: '1',
  generatedAt: '2026-07-26T00:00:00Z',
  root: '/repo',
  scope: 'project',
  localOnly: false,
  agents: [agent()],
  findings: [],
  stats: { fileCount: 14, totalBytes: 4096 },
  ...over,
});

const globalEntry = (over: Partial<GlobalEntry> = {}): GlobalEntry => ({
  root: '/Users/x/.claude',
  dir: '.claude',
  agents: [agent()],
  findings: [],
  stats: { fileCount: 2, totalBytes: 128 },
  ...over,
});

describe('confidenceLevel', () => {
  it('maps qualitative confidence into an ascending [0, 1] band', () => {
    expect(confidenceLevel('low')).toBeLessThan(confidenceLevel('medium'));
    expect(confidenceLevel('medium')).toBeLessThan(confidenceLevel('high'));
    expect(confidenceLevel('high')).toBeLessThanOrEqual(1);
    expect(confidenceLevel('low')).toBeGreaterThan(0);
  });
});

describe('severityToBlock', () => {
  it('maps report severities onto the three-tone block palette', () => {
    expect(severityToBlock('error')).toBe('error');
    expect(severityToBlock('warning')).toBe('warn');
    expect(severityToBlock('info')).toBe('ok');
  });
});

describe('tallyFindings', () => {
  it('counts each severity', () => {
    const tally = tallyFindings([
      finding({ severity: 'error' }),
      finding({ severity: 'warning' }),
      finding({ severity: 'warning' }),
      finding({ severity: 'info' }),
    ]);
    expect(tally).toEqual({ error: 1, warning: 2, info: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(tallyFindings([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe('computeStats', () => {
  it('derives agent count, file count, and severity tally from the report', () => {
    const stats = computeStats(
      report({
        agents: [agent(), agent({ kind: 'codex' })],
        findings: [finding({ severity: 'error' }), finding({ severity: 'warning' })],
        stats: { fileCount: 9, totalBytes: 1 },
      }),
    );
    expect(stats.agentCount).toBe(2);
    expect(stats.fileCount).toBe(9);
    expect(stats.tally).toEqual({ error: 1, warning: 1, info: 0 });
  });
});

describe('deriveAgentSources', () => {
  it('produces one deterministic ConfigSource per file path', () => {
    const a = agent({ files: ['CLAUDE.md', '.mcp.json'] });
    expect(deriveAgentSources(a)).toEqual(deriveAgentSources(a));
    expect(deriveAgentSources(a)).toEqual([
      { path: 'CLAUDE.md', size: 'CLAUDE.md'.length },
      { path: '.mcp.json', size: '.mcp.json'.length },
    ]);
  });

  it('changes when the file set changes', () => {
    const before = deriveAgentSources(agent({ files: ['CLAUDE.md'] }));
    const after = deriveAgentSources(agent({ files: ['AGENTS.md'] }));
    expect(after).not.toEqual(before);
  });
});

describe('buildAgentSignals', () => {
  it('maps each agent to display-ready strip data', () => {
    const signals = buildAgentSignals(
      report({
        agents: [agent({ kind: 'claude-code', confidence: 'medium', files: ['CLAUDE.md'] })],
      }),
    );
    expect(signals).toHaveLength(1);
    expect(signals[0]?.kind).toBe('CLAUDE-CODE');
    expect(signals[0]?.confidence).toBe(confidenceLevel('medium'));
    expect(signals[0]?.fileCount).toBe(1);
    expect(signals[0]?.sources).toEqual([{ path: 'CLAUDE.md', size: 'CLAUDE.md'.length }]);
  });
});

describe('displayKind', () => {
  it('renders the runtime id in terse caps', () => {
    expect(displayKind('claude-code')).toBe('CLAUDE-CODE');
  });
});

describe('topFindings', () => {
  it('orders by severity then original position and caps the count', () => {
    const findings = [
      finding({ id: 'w1', severity: 'warning' }),
      finding({ id: 'i1', severity: 'info' }),
      finding({ id: 'e1', severity: 'error' }),
      finding({ id: 'w2', severity: 'warning' }),
      finding({ id: 'e2', severity: 'error' }),
    ];
    const top = topFindings(findings, 3);
    expect(top.map((f) => f.id)).toEqual(['e1', 'e2', 'w1']);
  });

  it('does not mutate the input array', () => {
    const findings = [
      finding({ id: 'a', severity: 'info' }),
      finding({ id: 'b', severity: 'error' }),
    ];
    topFindings(findings);
    expect(findings.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('inheritedSummary', () => {
  it('is undefined with no global entries — the overview renders unchanged', () => {
    expect(inheritedSummary([])).toBeUndefined();
  });

  it('sums dirs, agents, and findings across entries in the §7 voice', () => {
    const entries = [
      globalEntry({
        agents: [agent(), agent({ kind: 'codex' })],
        findings: [finding(), finding({ severity: 'warning' })],
      }),
      globalEntry({
        root: '/Users/x/.cursor',
        dir: '.cursor',
        agents: [agent({ kind: 'cursor' })],
        findings: [finding({ severity: 'error' }), finding({ severity: 'info' })],
      }),
    ];
    expect(inheritedSummary(entries)).toBe('INHERITED · 2 GLOBAL DIRS · 3 AGENTS · 4 FINDINGS');
  });

  it('uses singular forms for single counts', () => {
    expect(inheritedSummary([globalEntry({ findings: [finding()] })])).toBe(
      'INHERITED · 1 GLOBAL DIR · 1 AGENT · 1 FINDING',
    );
  });

  it('reports honest zeros for a dir with nothing detected', () => {
    expect(inheritedSummary([globalEntry({ agents: [], findings: [] })])).toBe(
      'INHERITED · 1 GLOBAL DIR · 0 AGENTS · 0 FINDINGS',
    );
  });
});

describe('severitySummary', () => {
  it('lists only non-zero severities in the terse voice', () => {
    expect(severitySummary({ error: 1, warning: 3, info: 0 })).toBe('1 ERROR · 3 WARNINGS');
  });

  it('pluralizes and keeps info uncountable', () => {
    expect(severitySummary({ error: 2, warning: 1, info: 2 })).toBe(
      '2 ERRORS · 1 WARNING · 2 INFO',
    );
  });

  it('reads SIGNAL CLEAN when there are no findings', () => {
    expect(severitySummary({ error: 0, warning: 0, info: 0 })).toBe('SIGNAL CLEAN');
  });
});
