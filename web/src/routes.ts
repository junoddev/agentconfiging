/** Hash-based routing — deliberately no router dependency (DESIGN §4). The E4
 *  Inspector routes plus the internal component gallery. `agent/:kind` carries a
 *  param, so a Route is a small discriminated union rather than a bare string. */

/** Every routable page. `overview` is the default (rail item `01 SIGNAL`). */
export type RouteName =
  'overview' | 'agents' | 'agent' | 'findings' | 'artifacts' | 'instances' | 'gallery';

export type Route = { name: Exclude<RouteName, 'agent'> } | { name: 'agent'; kind: string };

/** Strip a leading '#', returning the path portion of a hash. */
function hashPath(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * Parse a `location.hash` into a Route. Unknown or empty hashes fall back to the
 * overview. Gallery sub-paths (`#/gallery/foundation`) stay on the gallery so
 * the committed gallery keeps working.
 */
export function parseRoute(hash: string): Route {
  const path = hashPath(hash);
  if (path === '' || path === '/') return { name: 'overview' };
  if (path === '/gallery' || path.startsWith('/gallery/')) return { name: 'gallery' };
  if (path === '/agents') return { name: 'agents' };
  if (path === '/findings') return { name: 'findings' };
  if (path === '/artifacts') return { name: 'artifacts' };
  if (path === '/instances') return { name: 'instances' };
  const agent = /^\/agent\/([^/]+)$/.exec(path);
  if (agent) return { name: 'agent', kind: decodeURIComponent(agent[1] as string) };
  return { name: 'overview' };
}

/** Canonical hash for a route — used by rail links and programmatic nav. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/';
    case 'agent':
      return `#/agent/${encodeURIComponent(route.kind)}`;
    default:
      return `#/${route.name}`;
  }
}
