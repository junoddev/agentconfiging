import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, type Route } from './routes.js';

describe('parseRoute', () => {
  it('defaults to home for empty and root hashes', () => {
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#')).toBe('home');
    expect(parseRoute('#/')).toBe('home');
  });

  it('routes #/gallery and gallery sub-paths to the gallery', () => {
    expect(parseRoute('#/gallery')).toBe('gallery');
    expect(parseRoute('#/gallery/foundation')).toBe('gallery');
  });

  it('does not match gallery-prefixed but distinct paths', () => {
    expect(parseRoute('#/galleryx')).toBe('home');
    expect(parseRoute('#/gal')).toBe('home');
  });

  it('routes unknown hashes to home', () => {
    expect(parseRoute('#/settings')).toBe('home');
    expect(parseRoute('#foundation')).toBe('home');
  });

  it('accepts hashes without the leading #', () => {
    expect(parseRoute('/gallery')).toBe('gallery');
    expect(parseRoute('/')).toBe('home');
  });
});

describe('routeHash', () => {
  it('round-trips every route through parseRoute', () => {
    const routes: Route[] = ['home', 'gallery'];
    for (const route of routes) {
      expect(parseRoute(routeHash(route))).toBe(route);
    }
  });
});
