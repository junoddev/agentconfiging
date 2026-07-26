/**
 * Achievements catalog DATA + a pure evaluator (SPEC §5 row 1: "an
 * achievements catalog (19+, data-file-driven)").
 *
 * Like the analyzers' model-staleness lists, the catalog is DATA: one flat,
 * declarative array where each entry carries a predicate `criterion` over the
 * computed {@link DashboardStats}. Adding an achievement means appending one
 * entry — no engine changes. `evaluateAchievements` is pure: stats in,
 * unlocked/locked partition out. It reads only the numeric stats, never
 * session content, so it is safe over adversarial data.
 */

import type { DashboardStats } from './types.js';

/** Grouping for UI display; purely cosmetic, does not affect unlocking. */
export type AchievementCategory =
  'sessions' | 'messages' | 'streaks' | 'consistency' | 'progression';

/** One catalog entry. `criterion` is a pure predicate over the computed stats. */
export interface Achievement {
  /** Stable unique id (kebab-case). */
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  /** Unlock predicate: true when the stats satisfy this achievement. */
  criterion: (stats: DashboardStats) => boolean;
}

/** Result of evaluating the catalog against a stats bundle. */
export interface AchievementEvaluation {
  unlocked: Achievement[];
  locked: Achievement[];
}

/**
 * The catalog (22 entries). Order is display order; ids are the stable key.
 * Thresholds are inclusive (`>=`), so each entry has a clean boundary.
 */
export const ACHIEVEMENTS: readonly Achievement[] = [
  // — Sessions —
  {
    id: 'first-session',
    name: 'First Contact',
    description: 'Complete your first session.',
    category: 'sessions',
    criterion: (s) => s.sessionCount >= 1,
  },
  {
    id: 'ten-sessions',
    name: 'Getting Started',
    description: 'Complete 10 sessions.',
    category: 'sessions',
    criterion: (s) => s.sessionCount >= 10,
  },
  {
    id: 'fifty-sessions',
    name: 'Regular',
    description: 'Complete 50 sessions.',
    category: 'sessions',
    criterion: (s) => s.sessionCount >= 50,
  },
  {
    id: 'hundred-sessions',
    name: 'Centurion',
    description: 'Complete 100 sessions.',
    category: 'sessions',
    criterion: (s) => s.sessionCount >= 100,
  },
  {
    id: 'five-hundred-sessions',
    name: 'Power User',
    description: 'Complete 500 sessions.',
    category: 'sessions',
    criterion: (s) => s.sessionCount >= 500,
  },
  // — Messages —
  {
    id: 'hundred-messages',
    name: 'Conversationalist',
    description: 'Exchange 100 messages.',
    category: 'messages',
    criterion: (s) => s.messageCounts.total >= 100,
  },
  {
    id: 'thousand-messages',
    name: 'Chatterbox',
    description: 'Exchange 1,000 messages.',
    category: 'messages',
    criterion: (s) => s.messageCounts.total >= 1000,
  },
  {
    id: 'ten-thousand-messages',
    name: 'Marathoner',
    description: 'Exchange 10,000 messages.',
    category: 'messages',
    criterion: (s) => s.messageCounts.total >= 10000,
  },
  {
    id: 'hundred-prompts',
    name: 'Prompt Smith',
    description: 'Type 100 prompts.',
    category: 'messages',
    criterion: (s) => s.promptCount >= 100,
  },
  // — Streaks —
  {
    id: 'streak-3',
    name: 'On a Roll',
    description: 'Reach a 3-day streak.',
    category: 'streaks',
    criterion: (s) => s.streak.longest >= 3,
  },
  {
    id: 'streak-7',
    name: 'Week Warrior',
    description: 'Reach a 7-day streak.',
    category: 'streaks',
    criterion: (s) => s.streak.longest >= 7,
  },
  {
    id: 'streak-14',
    name: 'Fortnight',
    description: 'Reach a 14-day streak.',
    category: 'streaks',
    criterion: (s) => s.streak.longest >= 14,
  },
  {
    id: 'streak-30',
    name: 'Iron Habit',
    description: 'Reach a 30-day streak.',
    category: 'streaks',
    criterion: (s) => s.streak.longest >= 30,
  },
  {
    id: 'current-streak-7',
    name: 'Hot Streak',
    description: 'Keep a 7-day streak going right now.',
    category: 'streaks',
    criterion: (s) => s.streak.current >= 7,
  },
  // — Consistency (active days) —
  {
    id: 'active-days-7',
    name: 'Seven Days',
    description: 'Be active on 7 different days.',
    category: 'consistency',
    criterion: (s) => s.activeDays >= 7,
  },
  {
    id: 'active-days-30',
    name: 'Committed',
    description: 'Be active on 30 different days.',
    category: 'consistency',
    criterion: (s) => s.activeDays >= 30,
  },
  {
    id: 'active-days-100',
    name: 'Ever Present',
    description: 'Be active on 100 different days.',
    category: 'consistency',
    criterion: (s) => s.activeDays >= 100,
  },
  {
    id: 'multi-runtime',
    name: 'Polyglot',
    description: 'Use two or more agent runtimes.',
    category: 'consistency',
    criterion: (s) => s.runtimes.length >= 2,
  },
  // — Progression (XP / level) —
  {
    id: 'xp-1000',
    name: 'Thousand XP',
    description: 'Earn 1,000 XP.',
    category: 'progression',
    criterion: (s) => s.xp.xp >= 1000,
  },
  {
    id: 'level-5',
    name: 'Apprentice',
    description: 'Reach level 5.',
    category: 'progression',
    criterion: (s) => s.xp.level >= 5,
  },
  {
    id: 'level-10',
    name: 'Journeyman',
    description: 'Reach level 10.',
    category: 'progression',
    criterion: (s) => s.xp.level >= 10,
  },
  {
    id: 'level-25',
    name: 'Master',
    description: 'Reach level 25.',
    category: 'progression',
    criterion: (s) => s.xp.level >= 25,
  },
];

/**
 * Partition the catalog into unlocked / locked for a given stats bundle.
 * Preserves catalog order within each partition. Pure and deterministic.
 */
export function evaluateAchievements(stats: DashboardStats): AchievementEvaluation {
  const unlocked: Achievement[] = [];
  const locked: Achievement[] = [];
  for (const achievement of ACHIEVEMENTS) {
    (achievement.criterion(stats) ? unlocked : locked).push(achievement);
  }
  return { unlocked, locked };
}
