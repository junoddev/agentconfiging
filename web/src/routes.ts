/** Hash-based routing — deliberately no router dependency. Two routes:
 *  the dashboard (default) and the internal component gallery. */

export type Route = 'home' | 'gallery';

/** Parse a `location.hash` value into a route. Anything that is not the
 *  gallery ("#/gallery" or a sub-path of it) is the dashboard. */
export function parseRoute(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  return path === '/gallery' || path.startsWith('/gallery/') ? 'gallery' : 'home';
}

/** Canonical hash for a route — used by rail links. */
export function routeHash(route: Route): string {
  return route === 'gallery' ? '#/gallery' : '#/';
}
