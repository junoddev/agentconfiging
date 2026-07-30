import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy.js';

describe('fuzzyMatch — subsequence', () => {
  it('matches an in-order subsequence, case-insensitively', () => {
    expect(fuzzyMatch('set', 'SETTINGS').matched).toBe(true);
    expect(fuzzyMatch('STG', 'SETTINGS').matched).toBe(true);
    expect(fuzzyMatch('git', 'GIT').matched).toBe(true);
  });

  it('rejects when a char is missing or out of order', () => {
    expect(fuzzyMatch('gx', 'GIT').matched).toBe(false);
    expect(fuzzyMatch('tig', 'GIT').matched).toBe(false);
  });

  it('treats an empty query as a (zero-score) match', () => {
    const m = fuzzyMatch('', 'ANYTHING');
    expect(m.matched).toBe(true);
    expect(m.score).toBe(0);
    expect(m.indices).toEqual([]);
  });

  it('reports the matched indices in order', () => {
    expect(fuzzyMatch('st', 'SETTINGS').indices).toEqual([0, 2]);
  });
});

describe('fuzzyMatch — ranking', () => {
  it('scores a prefix/consecutive run above a scattered match', () => {
    const tight = fuzzyMatch('set', 'SETTINGS'); // consecutive from the start
    const loose = fuzzyMatch('sns', 'SESSIONS'); // scattered
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it('rewards a word-start hit over a mid-word hit', () => {
    const start = fuzzyMatch('m', 'MEMORY');
    const mid = fuzzyMatch('m', 'TERMINAL');
    expect(start.score).toBeGreaterThan(mid.score);
  });

  it('prefers a shorter target on an otherwise-equal match', () => {
    const short = fuzzyMatch('git', 'GIT');
    const long = fuzzyMatch('git', 'GITFOO');
    expect(short.score).toBeGreaterThan(long.score);
  });
});
