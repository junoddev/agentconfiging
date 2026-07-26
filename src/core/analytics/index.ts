/**
 * Analytics engine barrel (SPEC §5 row 15 / E7). Pure token/cost analytics over
 * the typed history models: `computeAnalytics` turns `Session[]` into an
 * {@link AnalyticsResult} (token totals + API-equivalent cost per model, cache
 * efficiency, daily trend, hourly activity). Pricing is a dated data file
 * (pricing.ts). A thin server endpoint or the Analytics UI calls these; no I/O
 * lives here.
 */

export type {
  AnalyticsResult,
  ComputeAnalyticsOptions,
  CostBreakdown,
  DailyPoint,
  HourlyPoint,
  ModelUsage,
  TokenTotals,
} from './types.js';
export { computeAnalytics, costOf } from './analytics.js';
export {
  KNOWN_FAMILIES,
  PLAN_NOTE,
  PRICING_DATA_DATE,
  PRICING_NOTE,
  priceFor,
  type ModelRate,
  type PricedModel,
} from './pricing.js';
