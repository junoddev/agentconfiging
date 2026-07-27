/**
 * Tests for the pure cron parser + next/prev-run computer (bead ira.4). Cron
 * parsing is a bounded pure algorithm, so it is exercised exhaustively here:
 * wildcards, numbers, ranges, steps, lists, the DOM/DOW rule, presets, invalid
 * expressions, and next/prev-run from various instants. Dates are built and
 * asserted via LOCAL components so the tests are time-zone independent.
 */

import { describe, expect, it } from 'vitest';
import {
  computeNextRun,
  computePrevRun,
  isValidCron,
  matchesDate,
  parseCron,
  PRESETS,
  type ParsedCron,
} from './cron.js';

function parse(expr: string): ParsedCron {
  const p = parseCron(expr);
  if ('error' in p) throw new Error(`unexpected parse error: ${p.error}`);
  return p;
}

/** Sorted members of a field set (for readable assertions). */
function members(field: { values: Set<number> }): number[] {
  return [...field.values].sort((a, b) => a - b);
}

describe('parseCron — field syntax', () => {
  it('parses all-wildcards', () => {
    const p = parse('* * * * *');
    expect(p.minute.wildcard).toBe(true);
    expect(members(p.minute)).toHaveLength(60);
    expect(members(p.hour)).toHaveLength(24);
    expect(members(p.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('parses a single number', () => {
    const p = parse('30 4 * * *');
    expect(members(p.minute)).toEqual([30]);
    expect(members(p.hour)).toEqual([4]);
    expect(p.minute.wildcard).toBe(false);
  });

  it('parses a range a-b', () => {
    expect(members(parse('* 9-17 * * *').hour)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('parses a step */n over the whole field', () => {
    expect(members(parse('*/15 * * * *').minute)).toEqual([0, 15, 30, 45]);
    // A stepped wildcard is NOT an unrestricted wildcard.
    expect(parse('*/15 * * * *').minute.wildcard).toBe(false);
  });

  it('parses a stepped range a-b/n', () => {
    expect(members(parse('0-30/10 * * * *').minute)).toEqual([0, 10, 20, 30]);
  });

  it('parses a comma list mixing forms', () => {
    expect(members(parse('0,15,30-31,45 * * * *').minute)).toEqual([0, 15, 30, 31, 45]);
  });

  it('folds day-of-week 7 to 0 (Sunday)', () => {
    expect(members(parse('0 0 * * 7').dayOfWeek)).toEqual([0]);
    expect(members(parse('0 0 * * 0-7').dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('parseCron — rejects invalid expressions', () => {
  const bad = [
    '',
    '   ',
    '* * * *', // 4 fields
    '* * * * * *', // 6 fields
    '60 * * * *', // minute out of range
    '* 24 * * *', // hour out of range
    '* * 0 * *', // day-of-month below 1
    '* * * 13 *', // month out of range
    '5-1 * * * *', // inverted range
    '*/0 * * * *', // zero step
    'abc * * * *', // non-numeric
    '* * * * 8', // day-of-week above 7
    '1/2/3 * * * *', // double step
  ];
  for (const expr of bad) {
    it(`rejects ${JSON.stringify(expr)}`, () => {
      expect(isValidCron(expr)).toBe(false);
      expect('error' in parseCron(expr)).toBe(true);
    });
  }
});

describe('presets', () => {
  it('every documented preset parses', () => {
    for (const name of Object.keys(PRESETS)) {
      expect(isValidCron(name)).toBe(true);
    }
  });

  it('@hourly fires at minute 0 of every hour', () => {
    const p = parse('@hourly');
    expect(members(p.minute)).toEqual([0]);
    expect(p.hour.wildcard).toBe(true);
  });

  it('@daily and every-day are equivalent to 0 0 * * *', () => {
    expect(members(parse('@daily').hour)).toEqual([0]);
    expect(members(parse('every-day').hour)).toEqual([0]);
  });

  it('@weekly fires Sunday midnight', () => {
    const p = parse('@weekly');
    expect(members(p.dayOfWeek)).toEqual([0]);
    expect(members(p.hour)).toEqual([0]);
  });

  it('preset lookup is case-insensitive and trimmed', () => {
    expect(isValidCron('  @DAILY ')).toBe(true);
  });
});

describe('matchesDate', () => {
  it('matches on the DOM-or-DOW rule when both restricted', () => {
    // Fire on the 1st OR any Monday.
    const p = parse('0 0 1 * 1');
    // 2024-01-01 is a Monday → matches (both).
    expect(matchesDate(p, new Date(2024, 0, 1, 0, 0))).toBe(true);
    // 2024-01-08 is a Monday, not the 1st → matches via DOW.
    expect(matchesDate(p, new Date(2024, 0, 8, 0, 0))).toBe(true);
    // 2024-02-01 is a Thursday, the 1st → matches via DOM.
    expect(matchesDate(p, new Date(2024, 1, 1, 0, 0))).toBe(true);
    // 2024-01-02 is a Tuesday, not the 1st → no match.
    expect(matchesDate(p, new Date(2024, 0, 2, 0, 0))).toBe(false);
  });

  it('requires only the restricted field when the other is wildcard', () => {
    const p = parse('0 0 15 * *'); // 15th only, DOW wildcard
    expect(matchesDate(p, new Date(2024, 0, 15, 0, 0))).toBe(true);
    expect(matchesDate(p, new Date(2024, 0, 16, 0, 0))).toBe(false);
  });
});

describe('computeNextRun', () => {
  it('is strictly after `from`', () => {
    const from = new Date(2024, 0, 1, 12, 0); // matches @hourly boundary is 13:00
    const next = computeNextRun(parse('0 * * * *'), from)!;
    expect(next.getHours()).toBe(13);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('honors */15 stepping', () => {
    const next = computeNextRun(parse('*/15 * * * *'), new Date(2024, 0, 1, 9, 7))!;
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(15);
  });

  it('rolls to the next day for a daily schedule', () => {
    const next = computeNextRun(parse('30 2 * * *'), new Date(2024, 0, 1, 5, 0))!;
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(2);
    expect(next.getMinutes()).toBe(30);
  });

  it('finds the next matching weekday (DOW)', () => {
    // Fridays at 09:00. 2024-01-01 is a Monday → next Friday is the 5th.
    const next = computeNextRun(parse('0 9 * * 5'), new Date(2024, 0, 1, 0, 0))!;
    expect(next.getDate()).toBe(5);
    expect(next.getDay()).toBe(5);
    expect(next.getHours()).toBe(9);
  });

  it('crosses a month boundary', () => {
    // Midnight on the 1st. From Jan 15 → Feb 1.
    const next = computeNextRun(parse('0 0 1 * *'), new Date(2024, 0, 15, 0, 0))!;
    expect(next.getMonth()).toBe(1); // February
    expect(next.getDate()).toBe(1);
  });

  it('crosses a year boundary', () => {
    const next = computeNextRun(parse('0 0 1 1 *'), new Date(2024, 5, 1, 0, 0))!;
    expect(next.getFullYear()).toBe(2025);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it('returns undefined for an impossible date (Feb 30)', () => {
    expect(computeNextRun(parse('0 0 30 2 *'), new Date(2024, 0, 1, 0, 0))).toBeUndefined();
  });
});

describe('computePrevRun', () => {
  it('returns the current minute when it matches (inclusive)', () => {
    const prev = computePrevRun(parse('0 * * * *'), new Date(2024, 0, 1, 12, 0))!;
    expect(prev.getHours()).toBe(12);
    expect(prev.getMinutes()).toBe(0);
  });

  it('returns the most recent past occurrence', () => {
    const prev = computePrevRun(parse('*/15 * * * *'), new Date(2024, 0, 1, 9, 7))!;
    expect(prev.getMinutes()).toBe(0);
    expect(prev.getHours()).toBe(9);
  });

  it('steps back across a day boundary', () => {
    const prev = computePrevRun(parse('30 2 * * *'), new Date(2024, 0, 2, 1, 0))!;
    expect(prev.getDate()).toBe(1);
    expect(prev.getHours()).toBe(2);
    expect(prev.getMinutes()).toBe(30);
  });
});
