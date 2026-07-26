import { describe, expect, it } from 'vitest';
import type { CatalogEntryMeta, DetectedAgent, InstalledRecord } from '../api/types.js';
import { installedByKey } from './logic.js';
import {
  KNOWN_RUNTIMES,
  buildRuntimeSetups,
  detectedKindSet,
  partitionRuntimeSetups,
  runtimeTemplateEntries,
  type KnownRuntime,
} from './runtimeSetup.js';

function entry(over: Partial<CatalogEntryMeta> = {}): CatalogEntryMeta {
  return {
    key: over.key ?? `${over.kind ?? 'runtime-template'}/${over.name ?? 'x'}`,
    kind: 'runtime-template',
    name: 'x',
    description: 'a starter',
    version: '1.0.0',
    source: 'agentconfig-seed',
    tags: ['runtime-template', 'scaffold'],
    files: [],
    ...over,
  };
}

function record(over: Partial<InstalledRecord> = {}): InstalledRecord {
  return {
    key: over.key ?? 'runtime-template/cursor-starter',
    kind: 'runtime-template',
    name: 'cursor-starter',
    source: 'agentconfig-seed',
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00Z',
    files: ['.cursor/rules/project.mdc'],
    ...over,
  };
}

function agent(kind: string): DetectedAgent {
  return { kind, confidence: 'high', files: [], extras: {} };
}

// A catalog mixing installable artifacts with the 3 seed runtime templates.
const catalog: CatalogEntryMeta[] = [
  entry({ key: 'skill/git', kind: 'skill', name: 'git', tags: ['template'] }),
  entry({
    key: 'runtime-template/cursor-starter',
    name: 'cursor-starter',
    tags: ['runtime-template', 'cursor', 'scaffold'],
    files: ['.cursor/rules/project.mdc', '.cursorignore'],
  }),
  entry({
    key: 'runtime-template/codex-starter',
    name: 'codex-starter',
    tags: ['runtime-template', 'codex', 'scaffold'],
    files: ['AGENTS.md', '.codex/config.toml'],
  }),
  entry({
    key: 'runtime-template/gemini-starter',
    name: 'gemini-starter',
    tags: ['runtime-template', 'gemini', 'scaffold'],
    files: ['GEMINI.md', '.gemini/settings.json'],
  }),
];

const noInstall = installedByKey([]);
const noDetect = new Set<string>();

describe('runtimeTemplateEntries', () => {
  it('picks only runtime-template entries, order preserved', () => {
    expect(runtimeTemplateEntries(catalog).map((e) => e.name)).toEqual([
      'cursor-starter',
      'codex-starter',
      'gemini-starter',
    ]);
  });

  it('returns none when the catalog has no runtime templates', () => {
    expect(runtimeTemplateEntries([entry({ kind: 'skill', name: 's' })])).toHaveLength(0);
  });
});

describe('detectedKindSet', () => {
  it('collects the distinct detector kinds', () => {
    const set = detectedKindSet([agent('cursor'), agent('claude-code'), agent('cursor')]);
    expect([...set].sort()).toEqual(['claude-code', 'cursor']);
  });
});

describe('buildRuntimeSetups', () => {
  it('produces a row per known runtime plus any orphan templates', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect);
    expect(setups).toHaveLength(KNOWN_RUNTIMES.length);
  });

  it('attaches the seed template (and its files) to the matching runtime by tag', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect);
    const cursor = setups.find((s) => s.id === 'cursor');
    expect(cursor?.entry?.name).toBe('cursor-starter');
    expect(cursor?.files).toEqual(['.cursor/rules/project.mdc', '.cursorignore']);
  });

  it('matches gemini via its "gemini" tag even though the runtime id is gemini-cli', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect);
    const gemini = setups.find((s) => s.id === 'gemini-cli');
    expect(gemini?.entry?.name).toBe('gemini-starter');
    expect(gemini?.files).toEqual(['GEMINI.md', '.gemini/settings.json']);
  });

  it('leaves long-tail runtimes without a template (coming soon) — no files, no entry', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect);
    const zed = setups.find((s) => s.id === 'zed');
    expect(zed?.entry).toBeUndefined();
    expect(zed?.files).toEqual([]);
    expect(zed?.scaffolded).toBe(false);
  });

  it('marks a runtime scaffolded when agentconfig installed its template', () => {
    const installed = installedByKey([record({ key: 'runtime-template/cursor-starter' })]);
    const setups = buildRuntimeSetups(catalog, installed, noDetect);
    expect(setups.find((s) => s.id === 'cursor')?.scaffolded).toBe(true);
    expect(setups.find((s) => s.id === 'cursor')?.installedRecord?.name).toBe('cursor-starter');
    expect(setups.find((s) => s.id === 'codex')?.scaffolded).toBe(false);
  });

  it('marks a runtime detected when it is present in the project report', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, detectedKindSet([agent('gemini-cli')]));
    expect(setups.find((s) => s.id === 'gemini-cli')?.detected).toBe(true);
    expect(setups.find((s) => s.id === 'cursor')?.detected).toBe(false);
  });

  it('reports detected without scaffolded when the runtime pre-dates agentconfig', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, detectedKindSet([agent('cursor')]));
    const cursor = setups.find((s) => s.id === 'cursor');
    expect(cursor?.detected).toBe(true);
    expect(cursor?.scaffolded).toBe(false);
  });

  it('surfaces an orphan runtime template under its own name', () => {
    const withOrphan = [
      ...catalog,
      entry({ key: 'runtime-template/exotic', name: 'exotic-starter', tags: ['runtime-template'] }),
    ];
    const setups = buildRuntimeSetups(withOrphan, noInstall, noDetect);
    const orphan = setups.find((s) => s.id === 'runtime-template/exotic');
    expect(orphan?.displayName).toBe('exotic-starter');
    expect(orphan?.entry?.name).toBe('exotic-starter');
  });

  it('accepts a custom runtime list (isolation for tests)', () => {
    const only: KnownRuntime[] = [
      { id: 'cursor', displayName: 'Cursor', slugs: ['cursor'], detectKinds: ['cursor'] },
    ];
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect, only);
    // cursor (matched) + codex/gemini surface as orphans (unclaimed templates).
    expect(setups.map((s) => s.displayName)).toEqual(['Cursor', 'codex-starter', 'gemini-starter']);
  });
});

describe('partitionRuntimeSetups', () => {
  it('splits available (has a template) from coming-soon (no template)', () => {
    const setups = buildRuntimeSetups(catalog, noInstall, noDetect);
    const { available, comingSoon } = partitionRuntimeSetups(setups);
    expect(available.map((s) => s.id).sort()).toEqual(['codex', 'cursor', 'gemini-cli']);
    expect(comingSoon.every((s) => s.entry === undefined)).toBe(true);
    expect(available.length + comingSoon.length).toBe(setups.length);
  });

  it('yields no available rows when no runtime template exists', () => {
    const setups = buildRuntimeSetups([entry({ kind: 'skill', name: 's' })], noInstall, noDetect);
    const { available, comingSoon } = partitionRuntimeSetups(setups);
    expect(available).toHaveLength(0);
    expect(comingSoon.length).toBe(KNOWN_RUNTIMES.length);
  });
});
