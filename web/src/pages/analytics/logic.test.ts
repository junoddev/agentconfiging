import { describe, expect, it } from 'vitest';
import type { AnalyticsResponse } from '../../api/types.js';
import {
  barFraction,
  budgetAlertState,
  chartMax,
  formatPct,
  formatTokens,
  formatUsd,
  hasNoUsage,
  readBudget,
  writeBudget,
} from './logic.js';

describe('formatUsd', () => {
  it('formats to two decimals with thousands separators', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('shows sub-cent positive spend as <$0.01', () => {
    expect(formatUsd(0.004)).toBe('<$0.01');
  });
  it('is defensive against non-finite input', () => {
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });
});

describe('formatTokens', () => {
  it('compacts millions and thousands', () => {
    expect(formatTokens(1_234_567)).toBe('1.23M');
    expect(formatTokens(34_500)).toBe('34.5K');
    expect(formatTokens(742)).toBe('742');
    expect(formatTokens(0)).toBe('0');
  });
});

describe('formatPct', () => {
  it('rounds a ratio to a whole percent', () => {
    expect(formatPct(0.333)).toBe('33%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(1)).toBe('100%');
  });
});

describe('chartMax / barFraction', () => {
  it('returns the largest finite non-negative value', () => {
    expect(chartMax([1, 9, 3])).toBe(9);
    expect(chartMax([])).toBe(0);
    expect(chartMax([-4, Number.NaN, 2])).toBe(2);
  });
  it('scales a bar against the max and clamps to 0..1', () => {
    expect(barFraction(5, 10)).toBe(0.5);
    expect(barFraction(5, 0)).toBe(0);
    expect(barFraction(20, 10)).toBe(1);
  });
});

describe('budgetAlertState', () => {
  it('is off without a valid budget', () => {
    expect(budgetAlertState(50, undefined)).toBe('off');
    expect(budgetAlertState(50, 0)).toBe('off');
    expect(budgetAlertState(50, Number.NaN)).toBe('off');
  });
  it('grades spend against the threshold', () => {
    expect(budgetAlertState(10, 100)).toBe('ok');
    expect(budgetAlertState(80, 100)).toBe('near');
    expect(budgetAlertState(99.99, 100)).toBe('near');
    expect(budgetAlertState(100, 100)).toBe('over');
    expect(budgetAlertState(150, 100)).toBe('over');
  });
});

describe('hasNoUsage', () => {
  const base = { pricedMessages: 0, totalCost: 0 } as unknown as AnalyticsResponse;
  it('is true only when there is no priced activity', () => {
    expect(hasNoUsage(base)).toBe(true);
    expect(hasNoUsage({ ...base, pricedMessages: 3 })).toBe(false);
    expect(hasNoUsage({ ...base, totalCost: 1.2 })).toBe(false);
  });
});

describe('budget storage', () => {
  function fakeStore(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }

  it('round-trips a valid budget', () => {
    const s = fakeStore();
    writeBudget(s, 42);
    expect(readBudget(s)).toBe(42);
  });
  it('clears the budget when undefined', () => {
    const s = fakeStore();
    writeBudget(s, 42);
    writeBudget(s, undefined);
    expect(readBudget(s)).toBeUndefined();
  });
  it('ignores malformed / non-positive stored values', () => {
    const s = fakeStore();
    s.setItem('agentconfig:budget', 'nope');
    expect(readBudget(s)).toBeUndefined();
    s.setItem('agentconfig:budget', '-5');
    expect(readBudget(s)).toBeUndefined();
  });
  it('is a no-op without a store', () => {
    expect(readBudget(undefined)).toBeUndefined();
    expect(() => writeBudget(undefined, 10)).not.toThrow();
  });
});
