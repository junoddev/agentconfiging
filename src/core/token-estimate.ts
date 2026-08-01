/**
 * Lightweight token estimation for context-cost features.
 *
 * This intentionally avoids tokenizer dependencies on the cold-start path.
 * The single exported seam can be replaced with a more precise implementation
 * later without changing callers.
 */

export const DEFAULT_TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;

export interface EstimateTokensOptions {
  /**
   * Runtime-specific multiplier applied after the default chars/4 heuristic.
   * Use values above 1 for runtimes that trend token-heavier than the default,
   * and below 1 for runtimes that trend lighter.
   */
  runtimeFudgeFactor?: number;
}

function resolveRuntimeFudgeFactor(options: EstimateTokensOptions): number {
  const runtimeFudgeFactor = options.runtimeFudgeFactor ?? 1;

  if (!Number.isFinite(runtimeFudgeFactor) || runtimeFudgeFactor <= 0) {
    throw new RangeError('runtimeFudgeFactor must be a finite number greater than 0');
  }

  return runtimeFudgeFactor;
}

function estimateTokensFromCount(count: number, options: EstimateTokensOptions): number {
  const runtimeFudgeFactor = resolveRuntimeFudgeFactor(options);
  if (count <= 0) return 0;
  return Math.ceil((count / DEFAULT_TOKEN_ESTIMATE_CHARS_PER_TOKEN) * runtimeFudgeFactor);
}

/**
 * Estimate tokens from text using Unicode code points, not bytes or UTF-16
 * code units. Empty text is always 0. Non-empty estimates are rounded up so
 * tiny snippets still register as context cost.
 */
export function estimateTokens(text: string, options: EstimateTokensOptions = {}): number {
  return estimateTokensFromCount(Array.from(text).length, options);
}

/** Estimate tokens from retained byte size when manifest content is withheld. */
export function estimateTokensFromSizeBytes(
  sizeBytes: number,
  options: EstimateTokensOptions = {},
): number {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return estimateTokens('', options);
  return estimateTokensFromCount(Math.ceil(sizeBytes), options);
}
