import { describe, expect, it } from 'vitest';
import { formatIndex } from './finding.js';

describe('formatIndex', () => {
  it('zero-pads single digits to the 2-digit timetable form', () => {
    expect(formatIndex(1)).toBe('01');
    expect(formatIndex(9)).toBe('09');
  });

  it('leaves two or more digits untouched', () => {
    expect(formatIndex(12)).toBe('12');
    expect(formatIndex(100)).toBe('100');
  });
});
