/**
 * Typed models for the dashboard stats engine (SPEC §5 row 1 / E7).
 *
 * The engine is PURE: it consumes the typed {@link Session} / {@link PromptHistory}
 * models produced by the history adapters (src/core/history) and returns these
 * plain-data structures. It performs zero I/O and never interprets session
 * CONTENT — it only counts messages and reasons about their timestamps, so it
 * is safe over adversarial log data.
 *
 * TIMEZONE: every day boundary in this engine is UTC. A "day" is the UTC
 * calendar day of a timestamp (`Math.floor(ms / 86_400_000)`), so streaks,
 * active-day counts and heatmap cells are all deterministic and independent of
 * the machine's local zone. The only clock input is {@link ComputeStatsOptions.now}
 * (defaulting to `Date.now()`), which anchors the "current" streak and the
 * heatmap window; pass it explicitly for deterministic results.
 */

/** Message tallies across all sessions, split by role. */
export interface MessageCounts {
  /** Every message counted (user + assistant, including tool-result and meta lines). */
  total: number;
  user: number;
  assistant: number;
}

/** Daily activity streaks, measured in consecutive UTC days with activity. */
export interface StreakStats {
  /**
   * Length of the streak ending today or yesterday (UTC). Zero when the most
   * recent activity is older than yesterday — a streak "cools off" after a
   * missed day but stays current through the day itself.
   */
  current: number;
  /** Longest run of consecutive active UTC days ever recorded. */
  longest: number;
}

/** One cell of the activity heatmap: a UTC calendar day and its event count. */
export interface HeatmapCell {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Activity events on that day (session messages + prompts with a valid timestamp). */
  count: number;
}

/**
 * XP + level derived from lifetime activity. Formula (documented in stats.ts):
 * XP is a weighted sum of messages, sessions, active days and longest streak;
 * level follows a gentle quadratic curve so early levels come fast and later
 * ones cost more, without being grindy.
 */
export interface XpStats {
  /** Total XP earned. */
  xp: number;
  /** Current level (1-based; level 1 at 0 XP). */
  level: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP span of the current level (xpIntoLevel + this = next level). */
  xpForNextLevel: number;
  /** Progress toward the next level, `0..1`. */
  levelProgress: number;
}

/** The complete dashboard stats bundle. All numbers are real, never invented. */
export interface DashboardStats {
  /** Number of sessions supplied. */
  sessionCount: number;
  /** Message tallies by role across all sessions. */
  messageCounts: MessageCounts;
  /** Prompt-history entries supplied (0 when no prompt history is available). */
  promptCount: number;
  /** Distinct runtimes that contributed at least one session, sorted. */
  runtimes: string[];
  /** Distinct UTC days with any activity (all-time). */
  activeDays: number;
  /** Daily activity streaks. */
  streak: StreakStats;
  /** XP + level. */
  xp: XpStats;
  /**
   * Windowed activity heatmap: one cell per UTC day for the last
   * {@link ComputeStatsOptions.heatmapDays} days, oldest first, including
   * zero-count days. Activity outside the window still counts toward streaks
   * and totals, it just has no cell here.
   */
  heatmap: HeatmapCell[];
  /** Earliest / latest activity day (UTC `YYYY-MM-DD`), when any activity exists. */
  firstActiveDate?: string;
  lastActiveDate?: string;
}

/** Options for {@link computeStats}. */
export interface ComputeStatsOptions {
  /**
   * Epoch-ms "now", anchoring the current streak and the heatmap window's end.
   * Defaults to `Date.now()`. Pass explicitly for deterministic output.
   */
  now?: number;
  /** Heatmap window length in days (inclusive of today). Defaults to 365. */
  heatmapDays?: number;
}
