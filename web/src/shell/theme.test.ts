import { describe, expect, it } from 'vitest';
import { displayVersion, resolveInitialTheme, shouldShowOnboarding } from './theme.js';

describe('resolveInitialTheme', () => {
  it('honours a valid stored choice regardless of the system preference', () => {
    expect(resolveInitialTheme('ink', false)).toBe('ink');
    expect(resolveInitialTheme('paper', true)).toBe('paper');
  });

  it('falls back to the system preference when nothing is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('ink');
    expect(resolveInitialTheme(null, false)).toBe('paper');
  });

  it('treats an invalid stored value as unset and falls back to the system', () => {
    expect(resolveInitialTheme('neon', true)).toBe('ink');
    expect(resolveInitialTheme('', false)).toBe('paper');
  });
});

describe('shouldShowOnboarding', () => {
  it('shows onboarding until the flag reads exactly "true"', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    expect(shouldShowOnboarding('')).toBe(true);
    expect(shouldShowOnboarding('false')).toBe(true);
    expect(shouldShowOnboarding('true')).toBe(false);
  });
});

describe('displayVersion', () => {
  it('shows the probed version when present', () => {
    expect(displayVersion('0.0.0')).toBe('0.0.0');
    expect(displayVersion('1.2.3')).toBe('1.2.3');
  });

  it('shows a dash before the probe resolves or when it is blank', () => {
    expect(displayVersion(undefined)).toBe('—');
    expect(displayVersion('')).toBe('—');
    expect(displayVersion('   ')).toBe('—');
  });
});
