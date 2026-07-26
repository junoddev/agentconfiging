/**
 * Pure token/cost analytics engine (SPEC §5 row 15 / E7).
 *
 * `computeAnalytics` takes the typed {@link Session} models the history adapters
 * produce and returns an {@link AnalyticsResult}: token totals and API-equivalent
 * cost per model, cache efficiency, a daily cost/token trend and an hour-of-day
 * activity profile. It is the cost analogue of `computeStats`: zero I/O,
 * deterministic, fixture-testable.
 *
 * CONTENT-FREE: the engine reads only {@link SessionMessage.usage} token COUNTS,
 * the message `model` id, and timestamps. It never touches a content block, so
 * its output leaks no message body — only counts, costs and model names.
 *
 * COST: each priced message's tokens are multiplied by its model's per-token rate
 * from the DATED pricing data file (pricing.ts). Costs are API list-price
 * estimates; see PLAN_NOTE (a flat-rate subscription bills differently).
 *
 * TIMEZONE: day/hour boundaries are UTC.
 */

import type { Session, TokenUsage } from '../history/types.js';
import { PLAN_NOTE, PRICING_DATA_DATE, PRICING_NOTE, priceFor, type ModelRate } from './pricing.js';
import type {
  AnalyticsResult,
  ComputeAnalyticsOptions,
  CostBreakdown,
  DailyPoint,
  HourlyPoint,
  ModelUsage,
  TokenTotals,
} from './types.js';

const HOURS_PER_DAY = 24;

function emptyTotals(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function emptyCost(): CostBreakdown {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

/** Sum a usage block's four classes into a running totals accumulator. */
function addUsage(into: TokenTotals, u: TokenUsage): void {
  into.inputTokens += u.inputTokens;
  into.outputTokens += u.outputTokens;
  into.cacheCreationTokens += u.cacheCreationTokens;
  into.cacheReadTokens += u.cacheReadTokens;
}

/** All billed tokens in a usage block (input + output + both cache classes). */
function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens;
}

/** USD cost of one usage block at a given per-token rate. */
export function costOf(u: TokenUsage, rate: ModelRate): CostBreakdown {
  const input = u.inputTokens * rate.input;
  const output = u.outputTokens * rate.output;
  const cacheWrite = u.cacheCreationTokens * rate.cacheWrite;
  const cacheRead = u.cacheReadTokens * rate.cacheRead;
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead };
}

/** Add cost components of `b` into `a`. */
function addCost(a: CostBreakdown, b: CostBreakdown): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.total += b.total;
}

interface ModelAccum {
  model: string;
  priced: boolean;
  messageCount: number;
  tokens: TokenTotals;
  cost: CostBreakdown;
}

/** Epoch-ms for an ISO timestamp, or undefined when unparseable. */
function parseIsoMs(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) return undefined;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? undefined : ms;
}

/** UTC `YYYY-MM` for an epoch-ms value. */
function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/**
 * Compute the analytics bundle from parsed sessions.
 *
 * @param sessions Parsed sessions from any runtime's history adapter.
 * @param opts     `now` (epoch-ms) anchoring the current-month figure.
 */
export function computeAnalytics(
  sessions: readonly Session[],
  opts: ComputeAnalyticsOptions = {},
): AnalyticsResult {
  const now = opts.now ?? Date.now();
  const currentMonth = monthKey(now);

  const totals = emptyTotals();
  const totalCost = emptyCost();
  const byModel = new Map<string, ModelAccum>();
  const byDay = new Map<string, { tokens: number; cost: number }>();
  const hourly: HourlyPoint[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
    hour,
    messages: 0,
    tokens: 0,
  }));
  let pricedMessages = 0;
  let currentMonthCost = 0;

  for (const session of sessions) {
    for (const message of session.messages) {
      const usage = message.usage;
      if (usage === undefined) continue;
      pricedMessages += 1;

      const priced = priceFor(message.model);
      const cost = costOf(usage, priced.rate);
      const tokens = totalTokens(usage);

      addUsage(totals, usage);
      addCost(totalCost, cost);

      // Per-model aggregate (keyed by the raw id so distinct ids stay distinct).
      const modelId = message.model ?? 'unknown';
      let acc = byModel.get(modelId);
      if (acc === undefined) {
        acc = {
          model: modelId,
          priced: priced.priced,
          messageCount: 0,
          tokens: emptyTotals(),
          cost: emptyCost(),
        };
        byModel.set(modelId, acc);
      }
      acc.messageCount += 1;
      addUsage(acc.tokens, usage);
      addCost(acc.cost, cost);

      // Time-bucketed trends (skipped for messages with no parseable timestamp).
      const ms = parseIsoMs(message.timestamp);
      if (ms !== undefined) {
        const date = new Date(ms).toISOString().slice(0, 10);
        const day = byDay.get(date) ?? { tokens: 0, cost: 0 };
        day.tokens += tokens;
        day.cost += cost.total;
        byDay.set(date, day);

        const bucket = hourly[new Date(ms).getUTCHours()];
        if (bucket !== undefined) {
          bucket.messages += 1;
          bucket.tokens += tokens;
        }

        if (monthKey(ms) === currentMonth) currentMonthCost += cost.total;
      }
    }
  }

  const models: ModelUsage[] = [...byModel.values()]
    .map((m) => ({
      model: m.model,
      priced: m.priced,
      messageCount: m.messageCount,
      tokens: m.tokens,
      cost: m.cost,
    }))
    .sort((a, b) => b.cost.total - a.cost.total || a.model.localeCompare(b.model));

  const daily: DailyPoint[] = [...byDay.entries()]
    .map(([date, v]) => ({ date, tokens: v.tokens, cost: v.cost }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const inputSide = totals.inputTokens + totals.cacheCreationTokens + totals.cacheReadTokens;
  const cacheEfficiency = inputSide > 0 ? totals.cacheReadTokens / inputSide : 0;

  return {
    totals,
    totalCost: totalCost.total,
    cacheEfficiency,
    models,
    daily,
    hourly,
    pricedMessages,
    currentMonthCost,
    currentMonth,
    pricingDate: PRICING_DATA_DATE,
    pricingNote: PRICING_NOTE,
    planNote: PLAN_NOTE,
  };
}
