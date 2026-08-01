import { describe, expect, it } from 'vitest';
import { collectFiles, collectGlobalFiles, groupByRoot } from './collect.js';
import { joinGlobalPath } from './paths.js';

describe('collectFiles', () => {
  it('applies a predicate classify, de-dupes by path, and sorts by path (default)', () => {
    const agents = [{ files: ['b.md', 'a.md'] }, { files: ['a.md', 'c.md'] }];
    const isMd = (p: string) => (p.endsWith('.md') ? { path: p } : null);
    expect(collectFiles(agents, isMd).map((e) => e.path)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('rejects non-matching files via a null classify', () => {
    const agents = [{ files: ['keep.md', 'drop.txt'] }];
    const only = (p: string) => (p.endsWith('.md') ? { path: p } : null);
    expect(collectFiles(agents, only).map((e) => e.path)).toEqual(['keep.md']);
  });

  it('keeps richer entries and honours a multi-key compare (rules-style)', () => {
    interface Entry {
      path: string;
      source: string;
      name: string;
    }
    const classify = (p: string): Entry | null => {
      const claude = /\.claude\/rules\/([^/]+)\.md$/.exec(p);
      if (claude) return { path: p, source: 'claude', name: claude[1] as string };
      const cursor = /\.cursor\/rules\/([^/]+)\.mdc$/.exec(p);
      if (cursor) return { path: p, source: 'cursor', name: cursor[1] as string };
      return null;
    };
    const cmp = (a: Entry, b: Entry) =>
      a.source.localeCompare(b.source) ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path);
    const agents = [
      { files: ['.cursor/rules/z.mdc', '.claude/rules/b.md'] },
      { files: ['.claude/rules/a.md', 'nope.txt'] },
    ];
    expect(collectFiles(agents, classify, cmp).map((e) => `${e.source}:${e.name}`)).toEqual([
      'claude:a',
      'claude:b',
      'cursor:z',
    ]);
  });

  it('first classification of a path wins on a collision', () => {
    const agents = [{ files: ['x'] }, { files: ['x'] }];
    let n = 0;
    const classify = (p: string) => ({ path: p, seq: n++ });
    const out = collectFiles(agents, classify);
    expect(out).toHaveLength(1);
    expect(out[0]?.seq).toBe(0);
  });
});

describe('collectGlobalFiles', () => {
  it('joins each root, branches classify on the entry, de-dupes, and sorts', () => {
    interface E {
      root: string;
      dir: string;
      agents: { files: string[] }[];
    }
    const entries: E[] = [
      {
        root: '/Users/x/.claude',
        dir: '.claude',
        agents: [{ files: ['rules/a.md', 'skip.txt'] }],
      },
      {
        root: '/Users/x/.cursor',
        dir: '.cursor',
        agents: [{ files: ['rules/b.mdc'] }],
      },
    ];
    const classify = (e: E, rel: string) => {
      if (e.dir === '.claude' && rel.endsWith('.md'))
        return { path: joinGlobalPath(e.root, rel), root: e.root };
      if (e.dir === '.cursor' && rel.endsWith('.mdc'))
        return { path: joinGlobalPath(e.root, rel), root: e.root };
      return null;
    };
    expect(collectGlobalFiles(entries, classify).map((f) => f.path)).toEqual([
      '/Users/x/.claude/rules/a.md',
      '/Users/x/.cursor/rules/b.mdc',
    ]);
  });

  it('returns [] with no entries (page no-op)', () => {
    expect(collectGlobalFiles([], () => null)).toEqual([]);
  });
});

describe('groupByRoot', () => {
  it('groups items per root preserving first-seen order, never emitting an empty group', () => {
    const items = [
      { path: 'a', root: '/r1' },
      { path: 'b', root: '/r2' },
      { path: 'c', root: '/r1' },
    ];
    expect(groupByRoot(items)).toEqual([
      { root: '/r1', items: [items[0], items[2]] },
      { root: '/r2', items: [items[1]] },
    ]);
  });

  it('returns no groups for empty input', () => {
    expect(groupByRoot([])).toEqual([]);
  });
});
