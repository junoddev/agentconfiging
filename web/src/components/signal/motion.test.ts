import { describe, expect, it } from 'vitest';
import {
  REDUCED_MOTION_QUERY,
  resolveReducedMotion,
  systemPrefersReducedMotion,
} from './motion.js';

describe('systemPrefersReducedMotion', () => {
  it('reads the injected matchMedia with the right query', () => {
    let seen = '';
    const fake = (query: string) => {
      seen = query;
      return { matches: true };
    };
    expect(systemPrefersReducedMotion(fake)).toBe(true);
    expect(seen).toBe(REDUCED_MOTION_QUERY);
    expect(systemPrefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it('defaults to motion-allowed when matchMedia is unavailable', () => {
    expect(systemPrefersReducedMotion(undefined)).toBe(false);
  });
});

describe('resolveReducedMotion', () => {
  it('prop override wins in both directions', () => {
    expect(resolveReducedMotion(true, false)).toBe(true);
    expect(resolveReducedMotion(false, true)).toBe(false);
  });

  it('defers to the system preference when undefined', () => {
    expect(resolveReducedMotion(undefined, true)).toBe(true);
    expect(resolveReducedMotion(undefined, false)).toBe(false);
  });
});
