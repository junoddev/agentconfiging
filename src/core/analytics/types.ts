/**
 * Typed models for the pure analytics engine (SPEC §5 row 15 / E7).
 *
 * The engine consumes the shared {@link Session} model (from any runtime's
 * history adapter) and returns these plain-data aggregates. It is PURE: zero
 * I/O, deterministic, fixture-testable. It reads only per-message TOKEN COUNTS
 * ({@link SessionMessage.usage}) and timestamps — never message CONTENT — so it
 * is safe over adversarial logs and its output is content-free.
 *
 * TIMEZONE: day and hour boundaries are UTC, matching the stats engine.
 */

/** Token totals across the four billed classes. */
export interface TokenTotals {
  /** Fresh (uncached) input tokens. */
  inputTokens: number;
  /** Generated output tokens. */
  outputTokens: number;
  /** Tokens written into the prompt cache. */
  cacheCreationTokens: number;
  /** Tokens read from the prompt cache. */
  cacheReadTokens: number;
}

/** USD cost split by billed class, plus the total. */
export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

/** Per-model token + cost aggregate. `model` is a raw id — render as a text node. */
export interface ModelUsage {
  /** Raw model id from the log (adversarial text). */
  model: string;
  /** False when priced by the fallback rate (unknown family) — mark as approximate. */
  priced: boolean;
  /** Assistant messages attributed to this model that carried a usage block. */
  messageCount: number;
  tokens: TokenTotals;
  cost: CostBreakdown;
}

/** One day of the cost/token trend (UTC `YYYY-MM-DD`). */
export interface DailyPoint {
  date: string;
  /** Total input+output+cache tokens billed that day. */
  tokens: number;
  /** API-equivalent USD that day. */
  cost: number;
}

/** One hour-of-day activity bucket (UTC hour 0..23). */
export interface HourlyPoint {
  /** UTC hour of day, 0..23. */
  hour: number;
  /** Assistant messages (with usage) in that hour, all days combined. */
  messages: number;
  /** Total tokens in that hour, all days combined. */
  tokens: number;
}

/** The complete analytics bundle. Every field is a number or a model id string. */
export interface AnalyticsResult {
  /** Token totals across every priced message. */
  totals: TokenTotals;
  /** API-equivalent USD across every priced message. */
  totalCost: number;
  /**
   * Cache efficiency: cache-read tokens ÷ all input-side tokens
   * (fresh input + cache-write + cache-read), in `0..1`. 0 when no input tokens.
   */
  cacheEfficiency: number;
  /** Per-model aggregates, sorted by cost descending. */
  models: ModelUsage[];
  /** Daily trend, ascending by date; only days with priced activity appear. */
  daily: DailyPoint[];
  /** 24 hour-of-day buckets (0..23), always present (zeros where idle). */
  hourly: HourlyPoint[];
  /** Assistant messages that carried a usage block (the priced population). */
  pricedMessages: number;
  /** API-equivalent USD in the current UTC month (drives the chrome cost widget). */
  currentMonthCost: number;
  /** UTC `YYYY-MM` the {@link currentMonthCost} covers. */
  currentMonth: string;
  /** Date the pricing data file was last verified. */
  pricingDate: string;
  /** Provenance for the pricing rates. */
  pricingNote: string;
  /** Plan-aware caveat (API-equivalent estimate, not a bill). */
  planNote: string;
}

/** Options for {@link computeAnalytics}. */
export interface ComputeAnalyticsOptions {
  /**
   * Epoch-ms "now", anchoring the current-month figure. Defaults to `Date.now()`.
   * Pass explicitly for deterministic output.
   */
  now?: number;
}
