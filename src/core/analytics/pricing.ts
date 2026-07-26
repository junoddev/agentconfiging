/**
 * Model PRICING DATA (SPEC §5 row 15 / E7). Like the model-staleness lists
 * (analyzers/stale-models.ts), pricing lives in a DATED, updatable DATA FILE —
 * not scattered through the cost engine — so a rate change is a one-line edit
 * with a provenance note, never a logic change.
 *
 * Rates are USD per MILLION tokens (the form vendors publish), split by the four
 * billed token classes the runtime logs (input / output / cache-write /
 * cache-read). `priceFor` converts a raw model id into a per-TOKEN rate.
 *
 * PLAN-AWARE: these are LIST (API) rates. A Max/Pro subscription is flat-rate, so
 * a subscriber's real bill is the fixed plan price, not this number — the
 * analytics surface labels the computed figure an "API-equivalent" estimate (see
 * PLAN_NOTE), i.e. what the same token volume would cost at API list prices.
 *
 * Maintenance: refresh RATES_PER_MILLION and bump PRICING_DATA_DATE together.
 */

/** Date the rates below were last verified. */
export const PRICING_DATA_DATE = '2026-07-26';

/** Provenance for the rate table — surfaced next to any total. */
export const PRICING_NOTE =
  'Anthropic API list prices (USD per million tokens), verified ' +
  PRICING_DATA_DATE +
  '. Rates are a data file — update pricing.ts when they change.';

/** Plan-aware caveat surfaced beside every cost figure. */
export const PLAN_NOTE =
  'API-equivalent estimate: costs are computed from logged token counts at API ' +
  'list prices. On a flat-rate Max/Pro subscription your actual bill is the plan ' +
  'price — treat this as "what these tokens would cost on the API", not an invoice.';

/** USD per token for the four billed classes (the per-million table ÷ 1e6). */
export interface ModelRate {
  /** Fresh input tokens. */
  input: number;
  /** Generated output tokens. */
  output: number;
  /** Tokens written into the prompt cache (cache creation). */
  cacheWrite: number;
  /** Tokens read from the prompt cache. */
  cacheRead: number;
}

/**
 * USD per MILLION tokens, keyed by model FAMILY. Cache-write is the 5-minute
 * ephemeral rate (1.25× input); cache-read is 0.1× input — the standard Claude
 * prompt-caching multipliers.
 */
const RATES_PER_MILLION: Readonly<Record<string, ModelRate>> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/**
 * Fallback family used when a model id matches no known family (e.g. an internal
 * or newly-released id). Priced at the mid (sonnet) tier so the estimate is
 * reasonable rather than zero; `priceFor` flags the fallback so the UI can mark
 * such a model's cost as approximate.
 */
const FALLBACK_FAMILY = 'sonnet';

/** Per-token rate for a per-million entry. */
function perToken(r: ModelRate): ModelRate {
  return {
    input: r.input / 1_000_000,
    output: r.output / 1_000_000,
    cacheWrite: r.cacheWrite / 1_000_000,
    cacheRead: r.cacheRead / 1_000_000,
  };
}

/** Model FAMILY ids the rate table prices. */
export const KNOWN_FAMILIES: readonly string[] = Object.keys(RATES_PER_MILLION);

export interface PricedModel {
  /** Family matched from the id (`opus` / `sonnet` / `haiku`), or the fallback. */
  family: string;
  /** Per-token rate. */
  rate: ModelRate;
  /** True when a known family matched; false when the fallback rate was used. */
  priced: boolean;
}

/**
 * Resolve a raw model id to a per-token rate. Matching is by FAMILY substring
 * (`claude-opus-4-5` → opus, `claude-3-5-sonnet-…` → sonnet) so new dated ids
 * within a family price correctly without a table edit. An unmatched id falls
 * back to the mid tier and is flagged `priced:false`.
 */
export function priceFor(model: string | undefined): PricedModel {
  const id = (model ?? '').toLowerCase();
  for (const family of KNOWN_FAMILIES) {
    if (id.includes(family)) {
      return { family, rate: perToken(RATES_PER_MILLION[family] as ModelRate), priced: true };
    }
  }
  return {
    family: FALLBACK_FAMILY,
    rate: perToken(RATES_PER_MILLION[FALLBACK_FAMILY] as ModelRate),
    priced: false,
  };
}
