/**
 * Context-health tests (bead agentconfig-7yb.6). Driven by the committed
 * fixture corpus (fixtures/manifests/*.json) and small synthetic manifests —
 * zero I/O inside computeContextHealth. Pins the categorization, budget verdict,
 * largest-contributor ranking, and honest size-derived suggestions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest, type ManifestFile } from '../manifest.js';
import { computeContextHealth, CONTEXT_BUDGET_BYTES } from './context-health.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function loadFixture(name: string): Manifest {
  return parseManifest(JSON.parse(fs.readFileSync(path.join(manifestsDir, name), 'utf-8')));
}

/** Synthetic manifest from (path, size) pairs — content is irrelevant here. */
function makeManifest(sizes: Record<string, number>, opts: Partial<Manifest> = {}): Manifest {
  const files: ManifestFile[] = Object.entries(sizes).map(([p, size]) => ({
    path: p,
    size,
    sha256: '0'.repeat(64),
  }));
  return {
    root: '/tmp/proj',
    cwdBasename: 'proj',
    files,
    stats: { fileCount: files.length, totalBytes: files.reduce((n, f) => n + f.size, 0) },
    ...opts,
  };
}

describe('computeContextHealth', () => {
  it('classifies each context-loaded config file into its category', () => {
    const health = computeContextHealth(loadFixture('claude-rich.json'));
    const byCat = new Map(health.byCategory.map((c) => [c.category, c]));

    expect(byCat.get('instructions')?.bytes).toBe(576); // CLAUDE.md
    expect(byCat.get('settings')?.files).toBe(2); // settings.json + settings.local.json
    expect(byCat.get('settings')?.bytes).toBe(1519 + 370);
    expect(byCat.get('rules')?.files).toBe(2);
    expect(byCat.get('memory')?.files).toBe(2);
    expect(byCat.get('skills')?.files).toBe(3);
    expect(byCat.get('subagents')?.files).toBe(2);
    expect(byCat.get('commands')?.files).toBe(2);
    expect(byCat.get('mcp')?.bytes).toBe(547);
  });

  it('excludes runtime-state files that never load into context', () => {
    const paths = new Set(
      computeContextHealth(loadFixture('claude-rich.json')).largest.map((f) => f.path),
    );
    // hooks scripts, keybindings, statusline are config-adjacent but not context.
    expect([...paths].some((p) => p.includes('hooks/'))).toBe(false);
    expect(paths.has('.claude/keybindings.json')).toBe(false);
    expect(paths.has('.claude/statusline.sh')).toBe(false);
  });

  it('sums the total and reports it against the budget', () => {
    const health = computeContextHealth(loadFixture('claude-rich.json'));
    const expected =
      576 + 1519 + 370 + 269 + 281 + 399 + 406 + 491 + 224 + 499 + 513 + 500 + 464 + 338 + 547;
    expect(health.totalBytes).toBe(expected);
    expect(health.budgetBytes).toBe(CONTEXT_BUDGET_BYTES);
    expect(health.budgetRatio).toBeCloseTo(expected / CONTEXT_BUDGET_BYTES);
    expect(health.status).toBe('ok'); // a normal project is compact
    expect(health.suggestions).toEqual([]);
  });

  it('ranks the largest contributors first, path as tiebreak', () => {
    const health = computeContextHealth(
      makeManifest({
        'CLAUDE.md': 100,
        '.claude/rules/b.md': 200,
        '.claude/rules/a.md': 200,
        '.claude/settings.json': 50,
      }),
    );
    expect(health.largest.map((f) => f.path)).toEqual([
      '.claude/rules/a.md', // 200, path tiebreak wins over b.md
      '.claude/rules/b.md', // 200
      'CLAUDE.md', // 100
      '.claude/settings.json', // 50
    ]);
  });

  it('flags an over-budget total and a bloated instruction guide', () => {
    const health = computeContextHealth(makeManifest({ 'CLAUDE.md': 60 * 1024 }));
    expect(health.status).toBe('over');
    const ids = health.suggestions.map((s) => s.id);
    expect(ids[0]).toBe('over-budget'); // budget verdict leads
    expect(ids.some((id) => id.startsWith('guide-large-'))).toBe(true);
    expect(health.suggestions.find((s) => s.id === 'over-budget')?.severity).toBe('warn');
  });

  it('warns when many small rules add up', () => {
    const sizes: Record<string, number> = {};
    for (let i = 0; i < 6; i += 1) sizes[`.claude/rules/r${i}.md`] = 100;
    const health = computeContextHealth(makeManifest(sizes));
    const rules = health.suggestions.find((s) => s.id === 'rules-heavy');
    expect(rules).toBeDefined();
    expect(rules?.message).toContain('6 rule files');
  });

  it('is scope-aware: a global manifest anchors config at its root', () => {
    const health = computeContextHealth(
      makeManifest(
        { 'settings.json': 500, 'rules/style.md': 120, 'agents/rev.md': 300 },
        { cwdBasename: '.claude', scope: 'global', localOnly: true },
      ),
    );
    const byCat = new Map(health.byCategory.map((c) => [c.category, c.bytes]));
    expect(byCat.get('settings')).toBe(500);
    expect(byCat.get('rules')).toBe(120);
    expect(byCat.get('subagents')).toBe(300);
  });

  it('returns an empty view for a manifest with no agent config', () => {
    const health = computeContextHealth(makeManifest({ 'src/index.ts': 4000 }));
    expect(health.totalBytes).toBe(0);
    expect(health.fileCount).toBe(0);
    expect(health.byCategory).toEqual([]);
    expect(health.largest).toEqual([]);
    expect(health.status).toBe('ok');
    expect(health.suggestions).toEqual([]);
  });
});
