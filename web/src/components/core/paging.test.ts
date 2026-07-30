import { describe, expect, it } from 'vitest';
import { pageCount, pagerSummary } from './paging.js';

describe('pageCount', () => {
  it('rounds up partial pages', () => {
    expect(pageCount(42, 20)).toBe(3);
    expect(pageCount(40, 20)).toBe(2);
    expect(pageCount(1, 20)).toBe(1);
  });

  it('is at least 1, even for empty result sets', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(-5, 20)).toBe(1);
    expect(pageCount(10, 0)).toBe(1);
  });
});

describe('pagerSummary', () => {
  it('shows the 1-based inclusive range', () => {
    expect(pagerSummary(1, 20, 42)).toBe('Showing 1–20 of 42');
    expect(pagerSummary(2, 20, 42)).toBe('Showing 21–40 of 42');
  });

  it('clamps the last page to the total', () => {
    expect(pagerSummary(3, 20, 42)).toBe('Showing 41–42 of 42');
  });

  it('names an empty result set', () => {
    expect(pagerSummary(1, 20, 0)).toBe('0 results');
  });
});
