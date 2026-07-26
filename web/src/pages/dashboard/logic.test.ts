import { describe, expect, it } from 'vitest';
import type { AchievementsPayload, DashboardStats } from '../../api/types.js';
import {
  achievementProgressLabel,
  activityRange,
  formatRuntimes,
  groupThousands,
  hasNoHistory,
  levelProgressLevel,
} from './logic.js';
import { heatmapLevel, leadingBlankCount } from '../../components/core/index.js';

function stats(over: Partial<DashboardStats> = {}): DashboardStats {
  return {
    sessionCount: 0,
    messageCounts: { total: 0, user: 0, assistant: 0 },
    promptCount: 0,
    runtimes: [],
    activeDays: 0,
    streak: { current: 0, longest: 0 },
    xp: { xp: 0, level: 1, xpIntoLevel: 0, xpForNextLevel: 100, levelProgress: 0 },
    heatmap: [],
    ...over,
  };
}

describe('groupThousands', () => {
  it('groups with separators and truncates', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(12_345)).toBe('12,345');
    expect(groupThousands(1_000_000)).toBe('1,000,000');
    expect(groupThousands(NaN)).toBe('0');
  });
});

describe('formatRuntimes', () => {
  it('uppercases and joins, dashing the empty case', () => {
    expect(formatRuntimes([])).toBe('—');
    expect(formatRuntimes(['claude'])).toBe('CLAUDE');
    expect(formatRuntimes(['claude', 'codex'])).toBe('CLAUDE · CODEX');
  });
});

describe('achievementProgressLabel', () => {
  it('formats an unlocked/total tally', () => {
    const a: AchievementsPayload = {
      unlocked: [{ id: 'x', name: 'X', description: '', category: 'sessions' }],
      locked: [
        { id: 'y', name: 'Y', description: '', category: 'sessions' },
        { id: 'z', name: 'Z', description: '', category: 'streaks' },
      ],
    };
    expect(achievementProgressLabel(a)).toBe('1 / 3 UNLOCKED');
  });
});

describe('levelProgressLevel', () => {
  it('clamps to [0,1]', () => {
    expect(levelProgressLevel(stats({ xp: { ...stats().xp, levelProgress: 0.5 } }))).toBe(0.5);
    expect(levelProgressLevel(stats({ xp: { ...stats().xp, levelProgress: 2 } }))).toBe(1);
    expect(levelProgressLevel(stats({ xp: { ...stats().xp, levelProgress: NaN } }))).toBe(0);
  });
});

describe('hasNoHistory', () => {
  it('is true only with zero sessions, messages and prompts', () => {
    expect(hasNoHistory(stats())).toBe(true);
    expect(hasNoHistory(stats({ sessionCount: 1 }))).toBe(false);
    expect(hasNoHistory(stats({ promptCount: 3 }))).toBe(false);
  });
});

describe('activityRange', () => {
  it('renders a range, a single day, or nothing', () => {
    expect(activityRange(stats())).toBe('');
    expect(
      activityRange(stats({ firstActiveDate: '2026-07-26', lastActiveDate: '2026-07-26' })),
    ).toBe('2026-07-26');
    expect(
      activityRange(stats({ firstActiveDate: '2026-01-02', lastActiveDate: '2026-07-26' })),
    ).toBe('2026-01-02 → 2026-07-26');
  });
});

describe('heatmapLevel', () => {
  it('buckets counts into 0..4 relative to the busiest day', () => {
    expect(heatmapLevel(0, 10)).toBe(0);
    expect(heatmapLevel(5, 0)).toBe(0); // no max → empty
    expect(heatmapLevel(2, 10)).toBe(1);
    expect(heatmapLevel(5, 10)).toBe(2);
    expect(heatmapLevel(7, 10)).toBe(3);
    expect(heatmapLevel(10, 10)).toBe(4);
  });
});

describe('leadingBlankCount', () => {
  it('is the UTC weekday of the first date (Sun=0)', () => {
    expect(leadingBlankCount(undefined)).toBe(0);
    expect(leadingBlankCount('not-a-date')).toBe(0);
    // 2026-07-26 is a Sunday (UTC).
    expect(leadingBlankCount('2026-07-26')).toBe(0);
    // 2026-07-27 is a Monday.
    expect(leadingBlankCount('2026-07-27')).toBe(1);
  });
});
