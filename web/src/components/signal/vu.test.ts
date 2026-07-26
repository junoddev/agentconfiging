import { describe, expect, it } from 'vitest';
import { litSegments, segmentTones } from './vu.js';

describe('litSegments', () => {
  it('lights nothing at 0 and everything at 1', () => {
    expect(litSegments(0, 10)).toBe(0);
    expect(litSegments(1, 10)).toBe(10);
  });

  it('lights at least one segment for any non-zero level', () => {
    expect(litSegments(0.001, 10)).toBe(1);
  });

  it('never fills the meter below 1.0', () => {
    expect(litSegments(0.99, 10)).toBe(9);
  });

  it('rounds proportionally in the middle', () => {
    expect(litSegments(0.5, 10)).toBe(5);
    expect(litSegments(0.65, 10)).toBe(7);
  });

  it('clamps out-of-range levels and degenerate segment counts', () => {
    expect(litSegments(-1, 10)).toBe(0);
    expect(litSegments(2, 10)).toBe(10);
    expect(litSegments(0.5, 0)).toBe(0);
  });
});

describe('segmentTones', () => {
  it('marks lit low-range as signal and lit high-range as warn', () => {
    expect(segmentTones(0.9, 10, 0.8)).toEqual([
      'signal',
      'signal',
      'signal',
      'signal',
      'signal',
      'signal',
      'signal',
      'signal',
      'warn',
      'off',
    ]);
  });

  it('keeps unlit high-range segments off', () => {
    const tones = segmentTones(0.5, 10, 0.8);
    expect(tones.slice(0, 5)).toEqual(Array(5).fill('signal'));
    expect(tones.slice(5)).toEqual(Array(5).fill('off'));
  });

  it('is all off at zero and warns at the top when full', () => {
    expect(segmentTones(0, 4)).toEqual(['off', 'off', 'off', 'off']);
    expect(segmentTones(1, 4, 0.75)).toEqual(['signal', 'signal', 'signal', 'warn']);
  });
});
