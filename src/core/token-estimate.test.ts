import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKEN_ESTIMATE_CHARS_PER_TOKEN,
  estimateTokens,
  type EstimateTokensOptions,
} from './token-estimate.js';
import { estimateTokens as estimateTokensFromCore } from './index.js';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses chars/4 by default and rounds up', () => {
    expect(DEFAULT_TOKEN_ESTIMATE_CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a')).toBe(1);
  });

  it('counts Unicode code points rather than UTF-16 units or bytes', () => {
    expect('😀'.length).toBe(2);
    expect(estimateTokens('😀😀😀😀')).toBe(1);
    expect(estimateTokens('ééééé')).toBe(2);
  });

  it('applies an explicit runtime fudge factor before rounding', () => {
    expect(estimateTokens('abcdefgh', { runtimeFudgeFactor: 1.5 })).toBe(3);
    expect(estimateTokens('abcdefgh', { runtimeFudgeFactor: 0.5 })).toBe(1);
  });

  it('rejects non-positive and non-finite runtime fudge factors', () => {
    const invalid: EstimateTokensOptions[] = [
      { runtimeFudgeFactor: 0 },
      { runtimeFudgeFactor: -1 },
      { runtimeFudgeFactor: Number.POSITIVE_INFINITY },
      { runtimeFudgeFactor: Number.NaN },
    ];

    for (const options of invalid) {
      expect(() => estimateTokens('text', options)).toThrow(RangeError);
    }
  });

  it('is exported through the core barrel', () => {
    expect(estimateTokensFromCore('abcd')).toBe(1);
  });
});
