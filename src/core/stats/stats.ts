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
  UsageCostSummary,
  UsageSummary,
  UsageTokenTotals,
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

const USD_PER_MTOK_SOURCE = 'anthropic-public-pricing-standard-usd-per-mtok-2026-08-01';

interface ModelRates {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

const OPUS_45_RATES: ModelRates = { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 };
const OPUS_RATES: ModelRates = { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.5 };
const SONNET_RATES: ModelRates = { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 };
const HAIKU_45_RATES: ModelRates = { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 };
const HAIKU_35_RATES: ModelRates = { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 };
const HAIKU_3_RATES: ModelRates = {
  input: 0.25,
  output: 1.25,
  cacheCreation: 0.3,
  cacheRead: 0.03,
};

const PRICED_MODEL_IDS: readonly (readonly [string, ModelRates])[] = [
  ['claude-opus-4-5', OPUS_45_RATES],
  ['claude-opus-4-5-20251101', OPUS_45_RATES],
  ['claude-opus-4-1', OPUS_RATES],
  ['claude-3-opus-20240229', OPUS_RATES],
  ['claude-sonnet-4-5', SONNET_RATES],
  ['claude-sonnet-4-5-20250929', SONNET_RATES],
  ['claude-sonnet-4-0', SONNET_RATES],
  ['claude-3-7-sonnet-20250219', SONNET_RATES],
  ['claude-3-5-sonnet-20241022', SONNET_RATES],
  ['claude-3-5-sonnet-20240620', SONNET_RATES],
  ['claude-3-sonnet-20240229', SONNET_RATES],
  ['claude-haiku-4-5', HAIKU_45_RATES],
  ['claude-haiku-4-5-20251001', HAIKU_45_RATES],
  ['claude-3-5-haiku-20241022', HAIKU_35_RATES],
  ['claude-3-haiku-20240307', HAIKU_3_RATES],
];

const PRICED_MODEL_RATES = new Map<string, ModelRates>();
for (const [id, rates] of PRICED_MODEL_IDS) {
  PRICED_MODEL_RATES.set(id, rates);
  PRICED_MODEL_RATES.set(`anthropic/${id}`, rates);
}

const ZERO_TOKENS: UsageTokenTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
};

function emptyCost(): UsageCostSummary {
  return {
    status: 'unknown',
    currency: 'USD',
    pricedMessages: 0,
    unpricedMessages: 0,
  };
}

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

function ratesForModel(model: string | undefined): ModelRates | undefined {
  if (model === undefined || model.trim() === '') return undefined;
  return PRICED_MODEL_RATES.get(model.trim().toLowerCase());
}

function costForUsage(tokens: UsageTokenTotals, rates: ModelRates): number {
  return (
    (tokens.inputTokens * rates.input +
      tokens.outputTokens * rates.output +
      tokens.cacheCreationTokens * rates.cacheCreation +
      tokens.cacheReadTokens * rates.cacheRead) /
    1_000_000
  );
}

function addTokens(into: UsageTokenTotals, tokens: UsageTokenTotals): void {
  into.inputTokens += tokens.inputTokens;
  into.outputTokens += tokens.outputTokens;
  into.cacheCreationTokens += tokens.cacheCreationTokens;
  into.cacheReadTokens += tokens.cacheReadTokens;
  into.totalTokens += tokens.totalTokens;
}

function tokensWithTotal(
  usage: NonNullable<Session['messages'][number]['usage']>,
): UsageTokenTotals {
  const totalTokens =
    usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    totalTokens,
  };
}

/**
 * Summarize exact token counts from parsed usage blocks and estimate cost only
 * when the message model maps to the transparent local rate table. Estimates use
 * Anthropic's standard first-party USD/MTok rates with 5-minute cache writes, so
 * discounts, billing-plan details, 1h cache writes, geography multipliers, fast
 * mode, long-context premiums, and future model-specific prices can make the
 * true bill differ.
 */
export function computeSessionUsage(session: Session): UsageSummary {
  const tokens: UsageTokenTotals = { ...ZERO_TOKENS };
  let messagesWithUsage = 0;
  let completeUsageMessages = 0;
  let partialUsageMessages = 0;
  let assistantMessagesWithoutUsage = 0;
  let pricedMessages = 0;
  let unpricedMessages = 0;
  let amountUsd = 0;

  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;
    if (message.usage === undefined) {
      assistantMessagesWithoutUsage += 1;
      continue;
    }
    messagesWithUsage += 1;
    const messageTokens = tokensWithTotal(message.usage);
    addTokens(tokens, messageTokens);
    if (message.usage.status === 'partial') {
      partialUsageMessages += 1;
      unpricedMessages += 1;
      continue;
    }
    completeUsageMessages += 1;
    const rates = ratesForModel(message.model);
    if (rates === undefined) {
      unpricedMessages += 1;
    } else {
      pricedMessages += 1;
      amountUsd += costForUsage(messageTokens, rates);
    }
  }

  const cost: UsageCostSummary = {
    status:
      pricedMessages === 0
        ? 'unknown'
        : unpricedMessages > 0 || assistantMessagesWithoutUsage > 0
          ? 'partial'
          : 'known',
    currency: 'USD',
    pricedMessages,
    unpricedMessages,
  };
  if (pricedMessages > 0) {
    cost.amountUsd = amountUsd;
    cost.rateSource = USD_PER_MTOK_SOURCE;
  }
  return {
    tokens,
    messagesWithUsage,
    completeUsageMessages,
    partialUsageMessages,
    assistantMessagesWithoutUsage,
    cost,
  };
}

function combineUsage(sessions: readonly Session[]): UsageSummary {
  const tokens: UsageTokenTotals = { ...ZERO_TOKENS };
  let messagesWithUsage = 0;
  let completeUsageMessages = 0;
  let partialUsageMessages = 0;
  let assistantMessagesWithoutUsage = 0;
  let pricedMessages = 0;
  let unpricedMessages = 0;
  let amountUsd = 0;

  for (const session of sessions) {
    const usage = computeSessionUsage(session);
    addTokens(tokens, usage.tokens);
    messagesWithUsage += usage.messagesWithUsage;
    completeUsageMessages += usage.completeUsageMessages;
    partialUsageMessages += usage.partialUsageMessages;
    assistantMessagesWithoutUsage += usage.assistantMessagesWithoutUsage;
    pricedMessages += usage.cost.pricedMessages;
    unpricedMessages += usage.cost.unpricedMessages;
    amountUsd += usage.cost.amountUsd ?? 0;
  }

  const cost: UsageCostSummary = emptyCost();
  cost.pricedMessages = pricedMessages;
  cost.unpricedMessages = unpricedMessages;
  if (messagesWithUsage > 0 && pricedMessages > 0) {
    cost.status = unpricedMessages > 0 || assistantMessagesWithoutUsage > 0 ? 'partial' : 'known';
    cost.amountUsd = amountUsd;
    cost.rateSource = USD_PER_MTOK_SOURCE;
  }
  return {
    tokens,
    messagesWithUsage,
    completeUsageMessages,
    partialUsageMessages,
    assistantMessagesWithoutUsage,
    cost,
  };
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
  const usage = combineUsage(sessions);
  const heatmap = computeHeatmap(eventsPerDay, today, heatmapDays);

  const stats: DashboardStats = {
    sessionCount: sessions.length,
    messageCounts,
    promptCount,
    runtimes: [...runtimeSet].sort(),
    activeDays: activeDays.length,
    streak,
    xp,
    usage,
    heatmap,
  };
  if (activeDays.length > 0) {
    stats.firstActiveDate = dayIndexToDate(activeDays[0] as number);
    stats.lastActiveDate = dayIndexToDate(activeDays[activeDays.length - 1] as number);
  }
  return stats;
}
