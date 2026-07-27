import { describe, expect, it } from 'vitest';
import { SCHEDULE_PRESETS, formatLastRun, formatNextRun } from './schedule.js';

describe('schedule helpers', () => {
  it('offers named presets', () => {
    expect(SCHEDULE_PRESETS.map((p) => p.value)).toContain('@daily');
    expect(SCHEDULE_PRESETS.every((p) => p.value.startsWith('@'))).toBe(true);
  });

  it('formatNextRun renders an em dash for null/undefined', () => {
    expect(formatNextRun(null)).toBe('—');
    expect(formatNextRun(undefined)).toBe('—');
  });

  it('formatNextRun renders a timestamp for a number', () => {
    const out = formatNextRun(new Date(2024, 0, 1, 9, 0).getTime());
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(0);
  });

  it('formatLastRun renders "never" when unset', () => {
    expect(formatLastRun(null)).toBe('never');
    expect(formatLastRun(undefined)).toBe('never');
  });

  it('formatLastRun renders a timestamp when set', () => {
    expect(formatLastRun(new Date(2024, 0, 1, 9, 0).getTime())).not.toBe('never');
  });
});
