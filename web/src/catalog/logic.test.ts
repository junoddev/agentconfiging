import { describe, expect, it } from 'vitest';
import type { CatalogEntryMeta, InstalledRecord } from '../api/types.js';
import {
  DEFAULT_SHELVES,
  EMPTY_FILTER,
  entryMatchesQuery,
  filterEntries,
  installedByKey,
  installedCount,
  isInstalled,
  kindsPresent,
  quickAddCandidates,
  shelveEntries,
  templateCount,
} from './logic.js';

function entry(over: Partial<CatalogEntryMeta> = {}): CatalogEntryMeta {
  return {
    key: over.key ?? `${over.kind ?? 'skill'}/${over.name ?? 'x'}`,
    kind: 'skill',
    name: 'x',
    description: 'a helper',
    version: '1.0.0',
    source: 'agentconfig-seed',
    tags: ['template'],
    files: ['.claude/skills/x/SKILL.md'],
    ...over,
  };
}

function record(over: Partial<InstalledRecord> = {}): InstalledRecord {
  return {
    key: over.key ?? 'skill/x',
    kind: 'skill',
    name: 'x',
    source: 'agentconfig-seed',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00Z',
    files: ['.claude/skills/x/SKILL.md'],
    ...over,
  };
}

const sample: CatalogEntryMeta[] = [
  entry({ key: 'skill/git', kind: 'skill', name: 'git-commit-helper', tags: ['template', 'git'] }),
  entry({ key: 'subagent/rev', kind: 'subagent', name: 'reviewer', tags: ['template', 'review'] }),
  entry({ key: 'hook/fmt', kind: 'hook', name: 'formatter', tags: ['template', 'formatting'] }),
  entry({
    key: 'runtime-template/codex',
    kind: 'runtime-template',
    name: 'codex-bootstrap',
    tags: ['runtime-template', 'codex'],
  }),
  entry({
    key: 'runtime-template/gemini',
    kind: 'runtime-template',
    name: 'gemini-bootstrap',
    tags: ['runtime-template', 'gemini'],
  }),
];

describe('shelveEntries', () => {
  it('partitions installable kinds onto ARTIFACTS and runtime onto RUNTIME SETUP', () => {
    const shelves = shelveEntries(sample);
    expect(shelves.map((s) => s.id)).toEqual(['artifacts', 'runtime']);
    const artifacts = shelves.find((s) => s.id === 'artifacts');
    const runtime = shelves.find((s) => s.id === 'runtime');
    expect(artifacts?.entries.map((e) => e.kind)).toEqual(['skill', 'subagent', 'hook']);
    expect(runtime?.entries).toHaveLength(2);
  });

  it('assigns each entry to exactly one shelf (no duplication)', () => {
    const shelves = shelveEntries(sample);
    const total = shelves.reduce((n, s) => n + s.entries.length, 0);
    expect(total).toBe(sample.length);
  });

  it('preserves entry order within a shelf', () => {
    const shelves = shelveEntries(sample);
    expect(shelves[0]?.entries.map((e) => e.name)).toEqual([
      'git-commit-helper',
      'reviewer',
      'formatter',
    ]);
  });

  it('omits empty shelves and routes unknown kinds to the OTHER catch-all', () => {
    const shelves = shelveEntries([entry({ key: 'mystery/z', kind: 'mystery', name: 'z' })]);
    expect(shelves.map((s) => s.id)).toEqual(['other']);
    expect(shelves[0]?.entries).toHaveLength(1);
  });

  it('returns no shelves for an empty catalog', () => {
    expect(shelveEntries([])).toEqual([]);
  });

  it('exposes two default shelf specs', () => {
    expect(DEFAULT_SHELVES.map((s) => s.id)).toEqual(['artifacts', 'runtime']);
  });
});

describe('entryMatchesQuery', () => {
  const e = entry({ name: 'git-commit-helper', description: 'Draft commits', tags: ['git'] });

  it('matches everything on a blank query', () => {
    expect(entryMatchesQuery(e, '')).toBe(true);
    expect(entryMatchesQuery(e, '   ')).toBe(true);
  });

  it('matches on name, description, kind and tags, case-insensitively', () => {
    expect(entryMatchesQuery(e, 'GIT')).toBe(true);
    expect(entryMatchesQuery(e, 'draft')).toBe(true);
    expect(entryMatchesQuery(e, 'skill')).toBe(true);
  });

  it('requires every whitespace-separated term (AND)', () => {
    expect(entryMatchesQuery(e, 'git draft')).toBe(true);
    expect(entryMatchesQuery(e, 'git nope')).toBe(false);
  });
});

describe('filterEntries', () => {
  it('passes everything under the empty filter', () => {
    expect(filterEntries(sample, EMPTY_FILTER)).toHaveLength(sample.length);
  });

  it('narrows by kind set', () => {
    const out = filterEntries(sample, { ...EMPTY_FILTER, kinds: ['skill', 'hook'] });
    expect(out.map((e) => e.kind)).toEqual(['skill', 'hook']);
  });

  it('narrows by templatesOnly', () => {
    const out = filterEntries(sample, { ...EMPTY_FILTER, templatesOnly: true });
    // runtime entries carry 'runtime-template', not 'template'.
    expect(out.map((e) => e.kind)).toEqual(['skill', 'subagent', 'hook']);
  });

  it('combines kind, templatesOnly and query (all AND)', () => {
    const out = filterEntries(sample, {
      query: 'review',
      kinds: ['subagent'],
      templatesOnly: true,
    });
    expect(out.map((e) => e.name)).toEqual(['reviewer']);
  });
});

describe('kindsPresent / templateCount', () => {
  it('lists distinct kinds codepoint-sorted', () => {
    expect(kindsPresent(sample)).toEqual(['hook', 'runtime-template', 'skill', 'subagent']);
  });

  it('counts template-tagged entries', () => {
    expect(templateCount(sample)).toBe(3);
  });
});

describe('installed-state derivation', () => {
  const installed = installedByKey([record({ key: 'skill/git' }), record({ key: 'hook/fmt' })]);

  it('indexes records by key', () => {
    expect(installed.size).toBe(2);
    expect(installed.get('skill/git')?.name).toBe('x');
  });

  it('reports isInstalled per entry', () => {
    expect(isInstalled(sample[0] as CatalogEntryMeta, installed)).toBe(true);
    expect(isInstalled(sample[1] as CatalogEntryMeta, installed)).toBe(false);
  });

  it('counts installed entries within a set', () => {
    expect(installedCount(sample, installed)).toBe(2);
  });
});

describe('quickAddCandidates', () => {
  const installed = installedByKey([record({ key: 'skill/git' })]);

  it('returns not-installed entries of the given kind only', () => {
    const cands = quickAddCandidates(
      [
        entry({ key: 'skill/git', kind: 'skill', name: 'git' }),
        entry({ key: 'skill/lint', kind: 'skill', name: 'lint' }),
        entry({ key: 'hook/fmt', kind: 'hook', name: 'fmt' }),
      ],
      'skill',
      installed,
    );
    expect(cands.map((e) => e.name)).toEqual(['lint']);
  });

  it('further narrows by query', () => {
    const cands = quickAddCandidates(
      [
        entry({ key: 'skill/lint', kind: 'skill', name: 'lint', description: 'eslint runner' }),
        entry({ key: 'skill/docs', kind: 'skill', name: 'docs', description: 'doc writer' }),
      ],
      'skill',
      installed,
      'eslint',
    );
    expect(cands.map((e) => e.name)).toEqual(['lint']);
  });
});
