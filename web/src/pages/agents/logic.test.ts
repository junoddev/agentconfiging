import { describe, expect, it } from 'vitest';
import type { DetectedAgent, GlobalEntry, Report, ReportFinding } from '../../api/types.js';
import {
  artifactHref,
  confidenceLevel,
  extrasToRows,
  findAgent,
  findingsForAgent,
  globalAgentEntries,
  globalFilesForKind,
  toConfigSources,
  toRowSeverity,
} from './logic.js';

function agent(over: Partial<DetectedAgent> = {}): DetectedAgent {
  return { kind: 'claude-code', confidence: 'high', files: [], extras: {}, ...over };
}

function finding(over: Partial<ReportFinding> = {}): ReportFinding {
  return {
    id: 'f1',
    severity: 'warning',
    agent: 'claude-code',
    title: 'do the thing',
    detail: '',
    ...over,
  };
}

function report(over: Partial<Report> = {}): Report {
  return {
    version: '1',
    generatedAt: 'now',
    root: '/p',
    scope: 'project',
    localOnly: false,
    agents: [],
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
    ...over,
  };
}

function globalEntry(over: Partial<GlobalEntry> = {}): GlobalEntry {
  return {
    root: '/Users/x/.claude',
    dir: '.claude',
    agents: [],
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
    ...over,
  };
}

describe('globalAgentEntries', () => {
  it('keeps only entries with detected agents, preserving order', () => {
    const a = globalEntry({ root: '/u/.claude', agents: [agent()] });
    const b = globalEntry({ root: '/u/.cursor', dir: '.cursor' });
    const c = globalEntry({ root: '/u/.codex', dir: '.codex', agents: [agent({ kind: 'codex' })] });
    expect(globalAgentEntries([a, b, c])).toEqual([a, c]);
  });

  it('is empty for no entries — the agents page renders unchanged', () => {
    expect(globalAgentEntries([])).toEqual([]);
  });
});

describe('globalFilesForKind', () => {
  it('yields one group per entry where the SAME kind has files, rel + abs paths', () => {
    const entries = [
      globalEntry({
        root: '/Users/x/.claude',
        agents: [agent({ kind: 'claude-code', files: ['CLAUDE.md', 'settings.json'] })],
      }),
      globalEntry({
        root: '/Users/x/.cursor',
        dir: '.cursor',
        agents: [agent({ kind: 'cursor', files: ['rules.md'] })],
      }),
    ];
    expect(globalFilesForKind(entries, 'claude-code')).toEqual([
      {
        root: '/Users/x/.claude',
        files: [
          { rel: 'CLAUDE.md', abs: '/Users/x/.claude/CLAUDE.md' },
          { rel: 'settings.json', abs: '/Users/x/.claude/settings.json' },
        ],
      },
    ]);
  });

  it('normalizes a trailing-slash root when joining absolute paths', () => {
    const entries = [
      globalEntry({
        root: '/Users/x/.claude/',
        agents: [agent({ kind: 'claude-code', files: ['CLAUDE.md'] })],
      }),
    ];
    expect(globalFilesForKind(entries, 'claude-code')[0]?.files[0]?.abs).toBe(
      '/Users/x/.claude/CLAUDE.md',
    );
  });

  it('skips entries where the kind matched with zero files', () => {
    const entries = [globalEntry({ agents: [agent({ kind: 'claude-code', files: [] })] })];
    expect(globalFilesForKind(entries, 'claude-code')).toEqual([]);
  });

  it('is empty for an unknown kind or no entries — detail renders unchanged', () => {
    expect(globalFilesForKind([globalEntry({ agents: [agent()] })], 'nope')).toEqual([]);
    expect(globalFilesForKind([], 'claude-code')).toEqual([]);
  });
});

describe('findAgent', () => {
  it('finds the agent whose kind matches', () => {
    const a = agent({ kind: 'codex' });
    const r = report({ agents: [agent({ kind: 'claude-code' }), a] });
    expect(findAgent(r, 'codex')).toBe(a);
  });

  it('returns undefined for an unknown kind', () => {
    expect(findAgent(report({ agents: [agent()] }), 'nope')).toBeUndefined();
  });

  it('returns undefined when the report is absent', () => {
    expect(findAgent(undefined, 'claude-code')).toBeUndefined();
  });
});

describe('findingsForAgent', () => {
  it('keeps only findings linked to the kind, in order', () => {
    const r = report({
      findings: [
        finding({ id: 'a', agent: 'claude-code' }),
        finding({ id: 'b', agent: 'codex' }),
        finding({ id: 'c', agent: 'claude-code' }),
      ],
    });
    expect(findingsForAgent(r, 'claude-code').map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('returns [] for an unknown kind or absent report', () => {
    expect(findingsForAgent(report({ findings: [finding()] }), 'codex')).toEqual([]);
    expect(findingsForAgent(undefined, 'claude-code')).toEqual([]);
  });
});

describe('confidenceLevel', () => {
  it('maps each rating onto an ascending meter level', () => {
    expect(confidenceLevel('low')).toBeLessThan(confidenceLevel('medium'));
    expect(confidenceLevel('medium')).toBeLessThan(confidenceLevel('high'));
    expect(confidenceLevel('high')).toBeLessThanOrEqual(1);
    expect(confidenceLevel('low')).toBeGreaterThan(0);
  });
});

describe('toRowSeverity', () => {
  it('maps wire severities onto FindingRow severities', () => {
    expect(toRowSeverity('error')).toBe('error');
    expect(toRowSeverity('warning')).toBe('warn');
    expect(toRowSeverity('info')).toBe('ok');
  });
});

describe('toConfigSources', () => {
  it('turns paths into config sources', () => {
    expect(toConfigSources(['CLAUDE.md', '.claude/settings.json'])).toEqual([
      { path: 'CLAUDE.md', size: 0 },
      { path: '.claude/settings.json', size: 0 },
    ]);
  });
});

describe('artifactHref', () => {
  it('percent-encodes the path into the artifacts query', () => {
    expect(artifactHref('CLAUDE.md')).toBe('#/artifacts?path=CLAUDE.md');
    expect(artifactHref('.claude/settings.json')).toBe('#/artifacts?path=.claude%2Fsettings.json');
  });

  it('encodes spaces and hostile characters so they round-trip', () => {
    const href = artifactHref('a b/#x?y=&<z>');
    expect(href.startsWith('#/artifacts?path=')).toBe(true);
    const encoded = href.slice('#/artifacts?path='.length);
    expect(decodeURIComponent(encoded)).toBe('a b/#x?y=&<z>');
    expect(encoded).not.toContain(' ');
    expect(encoded).not.toContain('<');
  });
});

describe('extrasToRows', () => {
  it('renders scalar values as strings in insertion order', () => {
    expect(extrasToRows({ model: 'opus', tools: 12, enabled: true })).toEqual([
      { key: 'model', value: 'opus' },
      { key: 'tools', value: '12' },
      { key: 'enabled', value: 'true' },
    ]);
  });

  it('flattens nested objects into dotted keys', () => {
    const rows = extrasToRows({ settings: { model: 'opus', mcp: { count: 2 } } });
    expect(rows).toEqual([
      { key: 'settings.model', value: 'opus' },
      { key: 'settings.mcp.count', value: '2' },
    ]);
  });

  it('flattens arrays into indexed keys', () => {
    expect(extrasToRows({ servers: ['a', 'b'] })).toEqual([
      { key: 'servers[0]', value: 'a' },
      { key: 'servers[1]', value: 'b' },
    ]);
  });

  it('renders empty containers as {} / [] rather than dropping them', () => {
    expect(extrasToRows({ obj: {}, arr: [] })).toEqual([
      { key: 'obj', value: '{}' },
      { key: 'arr', value: '[]' },
    ]);
  });

  it('handles null, undefined, and never emits [object Object]', () => {
    const rows = extrasToRows({ a: null, b: undefined, c: { nested: true } });
    expect(rows).toEqual([
      { key: 'a', value: 'null' },
      { key: 'b', value: 'undefined' },
      { key: 'c.nested', value: 'true' },
    ]);
    for (const row of rows) expect(row.value).not.toContain('[object Object]');
  });

  it('does not hang on circular references', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const rows = extrasToRows({ root: cyclic });
    expect(rows).toContainEqual({ key: 'root.name', value: 'x' });
    expect(rows).toContainEqual({ key: 'root.self', value: '[circular]' });
  });

  it('keeps hostile string values verbatim (page renders them as text)', () => {
    const rows = extrasToRows({ note: '<img src=x onerror=alert(1)>' });
    expect(rows).toEqual([{ key: 'note', value: '<img src=x onerror=alert(1)>' }]);
  });

  it('bounds recursion depth on a pathologically deep shape (no stack overflow)', () => {
    let deep: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 50_000; i++) deep = { nested: deep };
    const rows = extrasToRows({ root: deep });
    expect(rows).toContainEqual(expect.objectContaining({ value: '[too deep]' }));
  });
});
