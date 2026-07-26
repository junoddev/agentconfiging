import { describe, expect, it } from 'vitest';
import type { ScanHit } from '../../api/types.js';
import { annotateHits, formatScanStats } from './hits.js';

const hit = (root: string): ScanHit => ({
  root,
  markers: ['CLAUDE.md'],
  runtimes: ['claude-code'],
});

describe('annotateHits', () => {
  it('marks hits whose root already exists as an instance', () => {
    const out = annotateHits([hit('/a'), hit('/b')], ['/b']);
    expect(out.map((h) => [h.root, h.added])).toEqual([
      ['/a', false],
      ['/b', true],
    ]);
  });

  it('preserves order and keeps the original hit fields', () => {
    const out = annotateHits([hit('/z'), hit('/a')], []);
    expect(out.map((h) => h.root)).toEqual(['/z', '/a']);
    expect(out[0]).toMatchObject({
      markers: ['CLAUDE.md'],
      runtimes: ['claude-code'],
      added: false,
    });
  });

  it('returns an empty array for no hits', () => {
    expect(annotateHits([], ['/a'])).toEqual([]);
  });
});

describe('formatScanStats', () => {
  it('shows only the dir count when nothing was skipped or truncated', () => {
    expect(formatScanStats({ dirsVisited: 42, truncated: false, skipped: 0 })).toBe('42 DIRS');
  });

  it('appends skipped and truncated when present', () => {
    expect(formatScanStats({ dirsVisited: 142, truncated: true, skipped: 3 })).toBe(
      '142 DIRS · 3 SKIPPED · TRUNCATED',
    );
  });
});
