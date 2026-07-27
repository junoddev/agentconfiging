import { describe, expect, it } from 'vitest';
import type { KnownProject } from '../../api/types.js';
import { formatKnownMeta, pruneKnownProjects } from './suggestions.js';

const proj = (root: string, extra: Partial<KnownProject> = {}): KnownProject => ({
  root,
  sessionCount: 1,
  ...extra,
});

describe('pruneKnownProjects', () => {
  it('removes suggestions whose root is already an instance', () => {
    const out = pruneKnownProjects([proj('/a'), proj('/b')], ['/b']);
    expect(out.map((p) => p.root)).toEqual(['/a']);
  });

  it('preserves order and keeps every field', () => {
    const out = pruneKnownProjects([proj('/z', { sessionCount: 4 }), proj('/a')], []);
    expect(out.map((p) => p.root)).toEqual(['/z', '/a']);
    expect(out[0]).toMatchObject({ root: '/z', sessionCount: 4 });
  });

  it('returns an empty array for no suggestions', () => {
    expect(pruneKnownProjects([], ['/a'])).toEqual([]);
  });
});

describe('formatKnownMeta', () => {
  it('pluralizes the session count and shows the last-seen UTC day', () => {
    expect(
      formatKnownMeta(proj('/a', { sessionCount: 3, lastSeen: '2026-07-26T12:00:00.000Z' })),
    ).toBe('3 SESSIONS · LAST 2026-07-26');
  });

  it('uses the singular for one session', () => {
    expect(formatKnownMeta(proj('/a', { sessionCount: 1 }))).toBe('1 SESSION');
  });

  it('omits the last-seen part when absent', () => {
    expect(formatKnownMeta(proj('/a', { sessionCount: 2 }))).toBe('2 SESSIONS');
  });
});
