import { describe, expect, it, vi } from 'vitest';
import { bootstrapToken, parseTokenHash } from './token.js';

describe('parseTokenHash', () => {
  it('extracts a token from the launch fragment', () => {
    expect(parseTokenHash('#token=abc123')).toEqual({ token: 'abc123', rest: '' });
  });

  it('handles a hash without the leading #', () => {
    expect(parseTokenHash('token=abc123')).toEqual({ token: 'abc123', rest: '' });
  });

  it('preserves a surviving route hash alongside the token', () => {
    expect(parseTokenHash('#token=abc123&/gallery')).toEqual({
      token: 'abc123',
      rest: '#/gallery',
    });
  });

  it('returns no token when none is present, keeping the route', () => {
    expect(parseTokenHash('#/gallery')).toEqual({ rest: '#/gallery' });
  });

  it('treats an empty hash as no token', () => {
    expect(parseTokenHash('')).toEqual({ rest: '' });
    expect(parseTokenHash('#')).toEqual({ rest: '' });
  });

  it('ignores an empty token= segment', () => {
    expect(parseTokenHash('#token=')).toEqual({ rest: '' });
  });

  it('percent-decodes the token value', () => {
    expect(parseTokenHash('#token=a%2Bb')).toEqual({ token: 'a+b', rest: '' });
  });

  it('only consumes the first token= segment', () => {
    expect(parseTokenHash('#token=first&token=second')).toEqual({
      token: 'first',
      rest: '#token=second',
    });
  });
});

/** Minimal in-memory Storage stand-in so cases don't leak through jsdom's real one. */
function fakeStore(seed?: string): Pick<Storage, 'getItem' | 'setItem'> & { value?: string } {
  const box: { value?: string } = { value: seed };
  return {
    value: seed,
    getItem: () => box.value ?? null,
    setItem: (_key: string, val: string) => {
      box.value = val;
    },
  };
}

describe('bootstrapToken', () => {
  it('reads the token, strips it, and persists it for refresh', () => {
    const replaceState = vi.fn();
    const store = fakeStore();
    const loc = { hash: '#token=secret', pathname: '/', search: '' };
    const token = bootstrapToken(loc, { replaceState }, store);
    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(store.getItem('any')).toBe('secret');
  });

  it('preserves path, query, and route hash when stripping', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#token=secret&/gallery', pathname: '/app', search: '?x=1' };
    const token = bootstrapToken(loc, { replaceState }, fakeStore());
    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app?x=1#/gallery');
  });

  it('recovers the persisted token on refresh (no fragment, no history write)', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#/gallery', pathname: '/', search: '' };
    const token = bootstrapToken(loc, { replaceState }, fakeStore('secret'));
    expect(token).toBe('secret');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('returns undefined when neither a fragment nor storage has a token', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#/gallery', pathname: '/', search: '' };
    expect(bootstrapToken(loc, { replaceState }, fakeStore())).toBeUndefined();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('still returns the token and strips when storage is unavailable', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#token=secret', pathname: '/', search: '' };
    const throwingStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(bootstrapToken(loc, { replaceState }, throwingStore)).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });
});
