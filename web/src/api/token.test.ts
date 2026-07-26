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

describe('bootstrapToken', () => {
  it('reads the token and strips it from the address bar', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#token=secret', pathname: '/', search: '' };
    const token = bootstrapToken(loc, { replaceState });
    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('preserves path, query, and route hash when stripping', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#token=secret&/gallery', pathname: '/app', search: '?x=1' };
    const token = bootstrapToken(loc, { replaceState });
    expect(token).toBe('secret');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app?x=1#/gallery');
  });

  it('returns undefined and does not touch history when no token', () => {
    const replaceState = vi.fn();
    const loc = { hash: '#/gallery', pathname: '/', search: '' };
    expect(bootstrapToken(loc, { replaceState })).toBeUndefined();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
