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
    expect(parseRoute('#/search')).toEqual({ name: 'search' });
    expect(routeHash({ name: 'search' })).toBe('#/search');
    expect(parseRoute('#/context')).toEqual({ name: 'context' });
    expect(routeHash({ name: 'context' })).toBe('#/context');
    expect(parseRoute('#/git')).toEqual({ name: 'git' });
    expect(routeHash({ name: 'git' })).toBe('#/git');
    expect(parseRoute('#/terminal')).toEqual({ name: 'terminal' });
    expect(routeHash({ name: 'terminal' })).toBe('#/terminal');
    expect(parseRoute('#/pipelines')).toEqual({ name: 'pipelines' });
    expect(routeHash({ name: 'pipelines' })).toBe('#/pipelines');
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

  it('round-trips explicit instance and agent targets', () => {
    const route: Route = {
      name: 'terminal',
      target: { instanceId: 'inst-1', agentKind: 'claude/code' },
    };
    expect(routeHash(route)).toBe('#/terminal?instance=inst-1&agent=claude%2Fcode');
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('does not serialize targets on aggregate routes', () => {
    const route: Route = {
      name: 'findings',
      target: { instanceId: 'inst-1', agentKind: 'codex' },
    };
    expect(routeHash(route)).toBe('#/findings');
    expect(parseRoute(routeHash(route))).toEqual({ name: 'findings' });
  });

  it('keeps a parsed aggregate target available for onward context-aware navigation', () => {
    const current = parseRoute('#/findings?instance=inst-1&agent=codex');
    expect(current).toEqual({
      name: 'findings',
      target: { instanceId: 'inst-1', agentKind: 'codex' },
    });
    expect(routeHash({ name: 'settings', target: current.target })).toBe(
      '#/settings?instance=inst-1&agent=codex',
    );
  });

  it('falls back to the route default for malformed, empty, or unknown targets', () => {
    expect(parseRoute('#/terminal?instance=')).toEqual({ name: 'terminal' });
    expect(parseRoute('#/terminal?instance=%E0%A4%A')).toEqual({ name: 'terminal' });
    expect(parseRoute('#/terminal?unknown=value')).toEqual({ name: 'terminal' });
    expect(parseRoute('#/terminal?instance=../etc')).toEqual({ name: 'terminal' });
    expect(parseRoute('#/agent/%E0%A4%A')).toEqual({ name: 'overview' });
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
      { name: 'search' },
      { name: 'context' },
      { name: 'git' },
      { name: 'terminal' },
      { name: 'pipelines' },
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
