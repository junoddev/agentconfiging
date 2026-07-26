/**
 * Achievements catalog + evaluator tests (SPEC §5 row 1: "19+, data-file-driven").
 * The zeroed-vs-maxed pair exercises EVERY catalog entry both ways (locked when
 * unmet, unlocked when met); targeted boundary tests pin representative
 * thresholds.
 */

import { describe, expect, it } from 'vitest';
import { computeStats } from './stats.js';
import { ACHIEVEMENTS, evaluateAchievements } from './achievements.js';
import type { DashboardStats } from './types.js';

const CATEGORIES = new Set(['sessions', 'messages', 'streaks', 'consistency', 'progression']);

/** Zeroed stats: nothing should unlock. */
const zeroed: DashboardStats = computeStats([], undefined, { now: Date.UTC(2026, 0, 1) });

/** Maxed stats: every catalog criterion must be satisfied. */
const maxed: DashboardStats = {
  sessionCount: 100_000,
  messageCounts: { total: 100_000, user: 50_000, assistant: 50_000 },
  promptCount: 100_000,
  runtimes: ['claude', 'codex', 'gemini'],
  activeDays: 100_000,
  streak: { current: 100_000, longest: 100_000 },
  xp: { xp: 10_000_000, level: 1_000, xpIntoLevel: 0, xpForNextLevel: 1, levelProgress: 0 },
  heatmap: [],
};

/** Build stats overriding only the fields a criterion reads. */
function statsWith(overrides: Partial<DashboardStats>): DashboardStats {
  return { ...zeroed, ...overrides };
}

describe('achievements catalog completeness', () => {
  it('ships at least 19 achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(19);
  });

  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry is well-formed data', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
      expect(CATEGORIES.has(a.category)).toBe(true);
      expect(typeof a.criterion).toBe('function');
    }
  });
});

describe('evaluateAchievements', () => {
  it('locks every achievement for zeroed stats', () => {
    const { unlocked, locked } = evaluateAchievements(zeroed);
    expect(unlocked).toEqual([]);
    expect(locked).toHaveLength(ACHIEVEMENTS.length);
  });

  it('unlocks every achievement for maxed stats', () => {
    const { unlocked, locked } = evaluateAchievements(maxed);
    expect(locked).toEqual([]);
    expect(unlocked).toHaveLength(ACHIEVEMENTS.length);
  });

  it('partitions the full catalog with no duplicates or drops', () => {
    const { unlocked, locked } = evaluateAchievements(statsWith({ sessionCount: 10 }));
    expect(unlocked.length + locked.length).toBe(ACHIEVEMENTS.length);
    const ids = [...unlocked, ...locked].map((a) => a.id);
    expect(new Set(ids).size).toBe(ACHIEVEMENTS.length);
  });

  it('preserves catalog order within each partition', () => {
    const { unlocked } = evaluateAchievements(statsWith({ sessionCount: 100 }));
    const order = ACHIEVEMENTS.map((a) => a.id);
    const unlockedOrder = unlocked.map((a) => a.id);
    expect(unlockedOrder).toEqual(order.filter((id) => unlockedOrder.includes(id)));
  });
});

/** Look up a single achievement's criterion by id. */
function unlocks(id: string, stats: DashboardStats): boolean {
  const achievement = ACHIEVEMENTS.find((a) => a.id === id);
  if (!achievement) throw new Error(`unknown achievement: ${id}`);
  return achievement.criterion(stats);
}

describe('representative unlock boundaries', () => {
  it('first-session: locked at 0, unlocked at 1', () => {
    expect(unlocks('first-session', statsWith({ sessionCount: 0 }))).toBe(false);
    expect(unlocks('first-session', statsWith({ sessionCount: 1 }))).toBe(true);
  });

  it('streak-7: locked at 6, unlocked at 7 (longest)', () => {
    expect(unlocks('streak-7', statsWith({ streak: { current: 0, longest: 6 } }))).toBe(false);
    expect(unlocks('streak-7', statsWith({ streak: { current: 0, longest: 7 } }))).toBe(true);
  });

  it('current-streak-7: reads the current streak, not the longest', () => {
    expect(unlocks('current-streak-7', statsWith({ streak: { current: 6, longest: 99 } }))).toBe(
      false,
    );
    expect(unlocks('current-streak-7', statsWith({ streak: { current: 7, longest: 7 } }))).toBe(
      true,
    );
  });

  it('multi-runtime: locked with one runtime, unlocked with two', () => {
    expect(unlocks('multi-runtime', statsWith({ runtimes: ['claude'] }))).toBe(false);
    expect(unlocks('multi-runtime', statsWith({ runtimes: ['claude', 'codex'] }))).toBe(true);
  });

  it('level-5: reads the derived level', () => {
    expect(unlocks('level-5', statsWith({ xp: { ...zeroed.xp, level: 4 } }))).toBe(false);
    expect(unlocks('level-5', statsWith({ xp: { ...zeroed.xp, level: 5 } }))).toBe(true);
  });
});
