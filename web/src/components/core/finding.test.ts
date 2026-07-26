import { describe, expect, it } from 'vitest';
import { formatIndex, severityClass, severityToken } from './finding.js';

describe('severityToken', () => {
  it('maps each severity onto its color token', () => {
    expect(severityToken('ok')).toBe('--signal');
    expect(severityToken('warn')).toBe('--warn');
    expect(severityToken('error')).toBe('--red');
  });
});

describe('severityClass', () => {
  it('maps each severity onto its block modifier class', () => {
    expect(severityClass('ok')).toBe('sev--ok');
    expect(severityClass('warn')).toBe('sev--warn');
    expect(severityClass('error')).toBe('sev--error');
  });
});

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
