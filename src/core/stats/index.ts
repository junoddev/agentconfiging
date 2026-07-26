/**
 * Stats engine barrel (SPEC §5 row 1 / E7). Pure analytics over the typed
 * history models: `computeStats` turns `Session[]` + `PromptHistory` into a
 * `DashboardStats` bundle; `evaluateAchievements` partitions the data-driven
 * `ACHIEVEMENTS` catalog against those stats. A thin server endpoint or the
 * dashboard UI (7yb.2) calls these; no I/O lives here.
 */

export type {
  ComputeStatsOptions,
  DashboardStats,
  HeatmapCell,
  MessageCounts,
  StreakStats,
  XpStats,
} from './types.js';
export { computeStats, computeXpTotal, xpToLevel } from './stats.js';
export type { Achievement, AchievementCategory, AchievementEvaluation } from './achievements.js';
export { ACHIEVEMENTS, evaluateAchievements } from './achievements.js';
