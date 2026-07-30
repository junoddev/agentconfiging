import { describe, expect, it } from 'vitest';
import type { DetectedAgent, GlobalEntry, Report, ReportFinding } from '../../api/types.js';
import {
  computeStats,
  configSourceRows,
  healthItems,
  inheritedSummary,
  severitySummary,
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

describe('configSourceRows', () => {
  it('flattens project files first, then each global dir, with provenance', () => {
    const rows = configSourceRows(
      report({
        agents: [
          agent({ kind: 'claude-code', files: ['CLAUDE.md'] }),
          agent({ kind: 'codex', files: ['AGENTS.md'] }),
        ],
      }),
      [globalEntry({ agents: [agent({ kind: 'claude-code', files: ['settings.json'] })] })],
    );
    expect(rows).toEqual([
      { path: 'CLAUDE.md', agent: 'claude-code', scope: 'project' },
      { path: 'AGENTS.md', agent: 'codex', scope: 'project' },
      {
        path: 'settings.json',
        agent: 'claude-code',
        scope: 'global',
        root: '/Users/x/.claude',
      },
    ]);
  });

  it('is empty for a fileless report with no global data', () => {
    expect(configSourceRows(report({ agents: [] }), [])).toEqual([]);
  });
});

describe('healthItems', () => {
  it('reads all-ok for a clean scan', () => {
    const items = healthItems({
      agentCount: 2,
      fileCount: 5,
      tally: { error: 0, warning: 0, info: 0 },
    });
    expect(items).toEqual([
      { ok: true, text: '2 agents detected' },
      { ok: true, text: 'no errors' },
      { ok: true, text: 'no warnings' },
    ]);
  });

  it('flags missing agents and non-zero severities, appending info notes', () => {
    const items = healthItems({
      agentCount: 0,
      fileCount: 0,
      tally: { error: 2, warning: 1, info: 1 },
    });
    expect(items).toEqual([
      { ok: false, text: 'no agents detected in this folder' },
      { ok: false, text: '2 errors' },
      { ok: false, text: '1 warning' },
      { ok: true, text: '1 info note' },
    ]);
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
    expect(severitySummary({ error: 1, warning: 3, info: 0 })).toBe('1 error · 3 warnings');
  });

  it('pluralizes and keeps info uncountable', () => {
    expect(severitySummary({ error: 2, warning: 1, info: 2 })).toBe(
      '2 errors · 1 warning · 2 info',
    );
  });

  it('reads clean when there are no findings', () => {
    expect(severitySummary({ error: 0, warning: 0, info: 0 })).toBe('clean');
  });
});
