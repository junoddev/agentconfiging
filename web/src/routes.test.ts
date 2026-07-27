import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, type Route } from './routes.js';

describe('parseRoute', () => {
  it('defaults to overview for empty and root hashes', () => {
    expect(parseRoute('')).toEqual({ name: 'overview' });
    expect(parseRoute('#')).toEqual({ name: 'overview' });
    expect(parseRoute('#/')).toEqual({ name: 'overview' });
  });

  it('routes the E4 top-level pages', () => {
    expect(parseRoute('#/agents')).toEqual({ name: 'agents' });
    expect(parseRoute('#/findings')).toEqual({ name: 'findings' });
    expect(parseRoute('#/artifacts')).toEqual({ name: 'artifacts' });
    expect(parseRoute('#/instances')).toEqual({ name: 'instances' });
    expect(parseRoute('#/catalog')).toEqual({ name: 'catalog' });
    expect(routeHash({ name: 'catalog' })).toBe('#/catalog');
    expect(parseRoute('#/marketplace')).toEqual({ name: 'marketplace' });
    expect(routeHash({ name: 'marketplace' })).toBe('#/marketplace');
    expect(parseRoute('#/dashboard')).toEqual({ name: 'dashboard' });
    expect(routeHash({ name: 'dashboard' })).toBe('#/dashboard');
    expect(parseRoute('#/sessions')).toEqual({ name: 'sessions' });
    expect(routeHash({ name: 'sessions' })).toBe('#/sessions');
    expect(parseRoute('#/analytics')).toEqual({ name: 'analytics' });
    expect(routeHash({ name: 'analytics' })).toBe('#/analytics');
    expect(parseRoute('#/search')).toEqual({ name: 'search' });
    expect(routeHash({ name: 'search' })).toBe('#/search');
    expect(parseRoute('#/context')).toEqual({ name: 'context' });
    expect(routeHash({ name: 'context' })).toBe('#/context');
  });

  it('routes agent detail with its kind param', () => {
    expect(parseRoute('#/agent/claude-code')).toEqual({ name: 'agent', kind: 'claude-code' });
  });

  it('decodes an encoded agent kind', () => {
    expect(parseRoute('#/agent/foo%2Fbar')).toEqual({ name: 'agent', kind: 'foo/bar' });
  });

  it('routes #/gallery and gallery sub-paths to the gallery', () => {
    expect(parseRoute('#/gallery')).toEqual({ name: 'gallery' });
    expect(parseRoute('#/gallery/foundation')).toEqual({ name: 'gallery' });
  });

  it('does not match gallery-prefixed but distinct paths', () => {
    expect(parseRoute('#/galleryx')).toEqual({ name: 'overview' });
    expect(parseRoute('#/gal')).toEqual({ name: 'overview' });
  });

  it('routes unknown hashes to overview', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'overview' });
    expect(parseRoute('#foundation')).toEqual({ name: 'overview' });
    expect(parseRoute('#/agent/')).toEqual({ name: 'overview' });
  });

  it('parses the E5 editor routes', () => {
    for (const name of [
      'settings',
      'instructions',
      'skills',
      'hooks',
      'rules',
      'memory',
      'mcp',
      'keybindings',
      'sync',
    ] as const) {
      expect(parseRoute(`#/${name}`)).toEqual({ name });
      expect(routeHash({ name })).toBe(`#/${name}`);
    }
  });

  it('accepts hashes without the leading #', () => {
    expect(parseRoute('/gallery')).toEqual({ name: 'gallery' });
    expect(parseRoute('/')).toEqual({ name: 'overview' });
  });
});

describe('routeHash', () => {
  it('round-trips every route through parseRoute', () => {
    const routes: Route[] = [
      { name: 'overview' },
      { name: 'agents' },
      { name: 'findings' },
      { name: 'artifacts' },
      { name: 'instances' },
      { name: 'dashboard' },
      { name: 'sessions' },
      { name: 'analytics' },
      { name: 'search' },
      { name: 'context' },
      { name: 'gallery' },
      { name: 'agent', kind: 'claude-code' },
    ];
    for (const route of routes) {
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
  });

  it('encodes an agent kind with a slash', () => {
    expect(routeHash({ name: 'agent', kind: 'foo/bar' })).toBe('#/agent/foo%2Fbar');
  });
});
