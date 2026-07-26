/**
 * Pure dashboard stats engine (SPEC §5 row 1 / E7).
 *
 * `computeStats` takes the typed models the history adapters produce — a
 * `Session[]` (from any runtime's adapter) plus an optional runtime-wide
 * `PromptHistory` — and returns a {@link DashboardStats} bundle. It is the
 * analytics analogue of `analyze()`: zero I/O, deterministic, fixture-testable
 * from parsed models.
 *
 * MULTI-RUNTIME: the engine only ever sees the shared `Session` model, so it is
 * agnostic to which runtime a session came from. Today only the claude adapter
 * exists; as codex/gemini/opencode adapters land, their sessions feed this same
 * function unchanged. Runtimes without an adapter simply contribute nothing —
 * an empty `Session[]` yields fully zeroed, crash-free stats.
 *
 * ADVERSARIAL DATA: session content is other people's text. This engine never
 * reads content blocks — it counts messages by role and reasons about
 * timestamps only. Every timestamp is parsed defensively (`Date.parse` /
 * finite-number checks); unparseable or non-finite timestamps are ignored, so
 * malformed logs can skew nothing.
 *
 * TIMEZONE: all day boundaries are UTC (see types.ts).
 */

import type { PromptHistory, Session } from '../history/types.js';
import type {
  ComputeStatsOptions,
  DashboardStats,
  HeatmapCell,
  MessageCounts,
  StreakStats,
  XpStats,
} from './types.js';

const MS_PER_DAY = 86_400_000;
const DEFAULT_HEATMAP_DAYS = 365;

/** XP weights. Kept modest so numbers stay meaningful, not grindy. */
const XP_PER_MESSAGE = 1;
const XP_PER_SESSION = 10;
const XP_PER_ACTIVE_DAY = 15;
const XP_PER_LONGEST_STREAK_DAY = 25;

/**
 * Level curve factor. Level `L` begins at `XP_LEVEL_FACTOR * (L - 1)^2` XP, so
 * the threshold gap widens each level (0, 100, 400, 900, 1600, ...). Quadratic
 * growth means early levels arrive quickly and later ones take real activity,
 * without runaway grind.
 */
const XP_LEVEL_FACTOR = 100;

/** UTC day index (days since epoch) for an epoch-ms value. */
function dayIndex(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/** UTC `YYYY-MM-DD` for a day index. */
function dayIndexToDate(index: number): string {
  return new Date(index * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Epoch-ms for a session-message ISO timestamp, or undefined if unparseable. */
function parseIsoMs(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) return undefined;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Epoch-ms for a prompt-history numeric timestamp, or undefined if unusable. */
function parseEpochMs(timestamp: number | undefined): number | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  return timestamp;
}

/** Total XP from lifetime activity (see weights above). */
export function computeXpTotal(
  messageTotal: number,
  sessionCount: number,
  activeDays: number,
  longestStreak: number,
): number {
  return (
    messageTotal * XP_PER_MESSAGE +
    sessionCount * XP_PER_SESSION +
    activeDays * XP_PER_ACTIVE_DAY +
    longestStreak * XP_PER_LONGEST_STREAK_DAY
  );
}

/** Level (1-based) for a total XP value, following the quadratic curve. */
export function xpToLevel(xp: number): number {
  if (xp <= 0) return 1;
  return Math.floor(Math.sqrt(xp / XP_LEVEL_FACTOR)) + 1;
}

/** Cumulative XP required to reach the start of a given level. */
function xpAtLevelStart(level: number): number {
  return XP_LEVEL_FACTOR * (level - 1) ** 2;
}

function computeXp(
  messageTotal: number,
  sessionCount: number,
  activeDays: number,
  longestStreak: number,
): XpStats {
  const xp = computeXpTotal(messageTotal, sessionCount, activeDays, longestStreak);
  const level = xpToLevel(xp);
  const start = xpAtLevelStart(level);
  const nextStart = xpAtLevelStart(level + 1);
  const xpForNextLevel = nextStart - start;
  const xpIntoLevel = xp - start;
  const levelProgress = xpForNextLevel > 0 ? xpIntoLevel / xpForNextLevel : 0;
  return { xp, level, xpIntoLevel, xpForNextLevel, levelProgress };
}

/** Longest run of consecutive integers in a sorted, unique ascending list. */
function longestConsecutiveRun(sortedDays: number[]): number {
  let longest = 0;
  let run = 0;
  let prev: number | undefined;
  for (const day of sortedDays) {
    run = prev !== undefined && day === prev + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = day;
  }
  return longest;
}

/**
 * Current streak: consecutive active days ending at today or yesterday (UTC).
 * A streak stays "current" through today even before today's activity, but a
 * fully missed day ends it.
 */
function currentStreak(activeDaySet: Set<number>, today: number): number {
  let anchor: number;
  if (activeDaySet.has(today)) anchor = today;
  else if (activeDaySet.has(today - 1)) anchor = today - 1;
  else return 0;

  let count = 0;
  for (let day = anchor; activeDaySet.has(day); day -= 1) count += 1;
  return count;
}

function computeStreaks(
  activeDays: number[],
  activeDaySet: Set<number>,
  today: number,
): StreakStats {
  return {
    current: currentStreak(activeDaySet, today),
    longest: longestConsecutiveRun(activeDays),
  };
}

/** Windowed heatmap: one cell per UTC day in `[today - heatmapDays + 1, today]`. */
function computeHeatmap(
  eventsPerDay: Map<number, number>,
  today: number,
  heatmapDays: number,
): HeatmapCell[] {
  const days = Math.max(0, Math.floor(heatmapDays));
  const cells: HeatmapCell[] = [];
  const start = today - days + 1;
  for (let day = start; day <= today; day += 1) {
    cells.push({ date: dayIndexToDate(day), count: eventsPerDay.get(day) ?? 0 });
  }
  return cells;
}

/**
 * Compute the full dashboard stats bundle from parsed history models.
 *
 * @param sessions       Parsed sessions from any runtime's history adapter.
 * @param promptHistory  Optional runtime-wide prompt history (adds prompt counts
 *                       and activity events); omit when unavailable.
 * @param opts           `now` (epoch-ms anchor) and `heatmapDays` window.
 */
export function computeStats(
  sessions: readonly Session[],
  promptHistory?: PromptHistory,
  opts: ComputeStatsOptions = {},
): DashboardStats {
  const now = opts.now ?? Date.now();
  const heatmapDays = opts.heatmapDays ?? DEFAULT_HEATMAP_DAYS;
  const today = dayIndex(now);

  const messageCounts: MessageCounts = { total: 0, user: 0, assistant: 0 };
  const runtimeSet = new Set<string>();
  const activeDaySet = new Set<number>();
  const eventsPerDay = new Map<number, number>();

  const recordEvent = (ms: number): void => {
    const day = dayIndex(ms);
    activeDaySet.add(day);
    eventsPerDay.set(day, (eventsPerDay.get(day) ?? 0) + 1);
  };

  for (const session of sessions) {
    runtimeSet.add(session.runtime);
    for (const message of session.messages) {
      messageCounts.total += 1;
      if (message.role === 'user') messageCounts.user += 1;
      else if (message.role === 'assistant') messageCounts.assistant += 1;
      const ms = parseIsoMs(message.timestamp);
      if (ms !== undefined) recordEvent(ms);
    }
    // A session with no per-message timestamps still marks its boundary days.
    const startMs = parseIsoMs(session.startedAt);
    if (startMs !== undefined) activeDaySet.add(dayIndex(startMs));
    const endMs = parseIsoMs(session.endedAt);
    if (endMs !== undefined) activeDaySet.add(dayIndex(endMs));
  }

  const promptCount = promptHistory?.entries.length ?? 0;
  if (promptHistory) {
    for (const entry of promptHistory.entries) {
      const ms = parseEpochMs(entry.timestamp);
      if (ms !== undefined) recordEvent(ms);
    }
  }

  const activeDays = [...activeDaySet].sort((a, b) => a - b);
  const streak = computeStreaks(activeDays, activeDaySet, today);
  const xp = computeXp(messageCounts.total, sessions.length, activeDays.length, streak.longest);
  const heatmap = computeHeatmap(eventsPerDay, today, heatmapDays);

  const stats: DashboardStats = {
    sessionCount: sessions.length,
    messageCounts,
    promptCount,
    runtimes: [...runtimeSet].sort(),
    activeDays: activeDays.length,
    streak,
    xp,
    heatmap,
  };
  if (activeDays.length > 0) {
    stats.firstActiveDate = dayIndexToDate(activeDays[0] as number);
    stats.lastActiveDate = dayIndexToDate(activeDays[activeDays.length - 1] as number);
  }
  return stats;
}
