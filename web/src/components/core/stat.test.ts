import { describe, expect, it } from 'vitest';
import { deltaTone, formatDelta } from './stat.js';

describe('formatDelta', () => {
  it('prefixes positive deltas with +', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(14)).toBe('+14');
  });

  it('keeps the minus sign on negative deltas', () => {
    expect(formatDelta(-2)).toBe('-2');
  });

  it('renders zero as ±0', () => {
    expect(formatDelta(0)).toBe('±0');
  });
});

describe('deltaTone', () => {
  it('maps growth to accent, loss to danger, no change to dim', () => {
    expect(deltaTone(5)).toBe('accent');
    expect(deltaTone(-1)).toBe('danger');
    expect(deltaTone(0)).toBe('dim');
  });
});
