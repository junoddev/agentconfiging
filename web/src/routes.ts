/** Hash-based routing — deliberately no router dependency (DESIGN §4). The E4
 *  Inspector routes plus the internal component gallery. `agent/:kind` carries a
 *  param, and optional query targets carry explicit instance/agent context. */

import {
  isSafeAgentKind,
  normalizeNavigationTarget,
  targetForRoute,
  type NavigationTarget,
} from './navigation.js';

export type { NavigationTarget } from './navigation.js';

/** Every routable page. `overview` is the default (sidebar item Overview).
 *  The E5 editor routes (settings…sync) are write-back config editors. */
export type RouteName =
  | 'overview'
  | 'agents'
  | 'agent'
  | 'findings'
  | 'artifacts'
  | 'instances'
  | 'settings'
  | 'instructions'
  | 'skills'
  | 'hooks'
  | 'rules'
  | 'memory'
  | 'mcp'
  | 'keybindings'
  | 'sync'
  | 'catalog'
  | 'extensions'
  | 'marketplace'
  | 'dashboard'
  | 'sessions'
  | 'search'
  | 'context'
  | 'git'
  | 'terminal'
  | 'pipelines'
  | 'gallery';

export type Route =
  | { name: Exclude<RouteName, 'agent'>; target?: NavigationTarget }
  | { name: 'agent'; kind: string; target?: NavigationTarget };

/**
 * Display labels — the single label seam (Console §7: labels are nouns, sans,
 * sentence case). The sidebar (shell/Sidebar), the command palette
 * (command/commands) and any breadcrumb all read from here so the three nav
 * seams can never drift.
 */
export const ROUTE_LABELS: Record<RouteName, string> = {
  overview: 'Overview',
  agents: 'Agents',
  agent: 'Agent detail',
  findings: 'Findings',
  artifacts: 'Artifacts',
  instances: 'Folders',
  settings: 'Settings',
  instructions: 'Instructions',
  skills: 'Skills',
  hooks: 'Hooks',
  rules: 'Rules',
  memory: 'Memory',
  mcp: 'MCP',
  keybindings: 'Keybindings',
  sync: 'Sync',
  catalog: 'Catalog',
  extensions: 'Extensions',
  marketplace: 'Marketplace',
  dashboard: 'Dashboard',
  sessions: 'Sessions',
  search: 'Search',
  context: 'Context',
  git: 'Git',
  terminal: 'Terminal',
  pipelines: 'Pipelines',
  gallery: 'Gallery',
};

/** The E5 editor route names, in rail order — simple (no-param) routes. */
export const EDITOR_ROUTES = [
  'settings',
  'instructions',
  'skills',
  'hooks',
  'rules',
  'memory',
  'mcp',
  'keybindings',
  'sync',
] as const;

/** Strip a leading '#', returning the path portion of a hash. */
function hashPath(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/** Decode one route component without allowing malformed percent escapes. */
function decodePart(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/** Parse the deliberately small `?instance=…&agent=…` target contract. */
function parseTarget(query: string): NavigationTarget | undefined {
  if (query === '') return undefined;
  const target: NavigationTarget = {};
  const seen = new Set<string>();
  for (const pair of query.split('&')) {
    const equals = pair.indexOf('=');
    if (equals <= 0 || equals !== pair.lastIndexOf('=')) return undefined;
    const key = pair.slice(0, equals);
    if ((key !== 'instance' && key !== 'agent') || seen.has(key)) return undefined;
    const value = decodePart(pair.slice(equals + 1));
    if (value === undefined) return undefined;
    seen.add(key);
    if (key === 'instance') target.instanceId = value;
    else target.agentKind = value;
  }
  return normalizeNavigationTarget(target);
}

function routeParts(hash: string): { path: string; target?: NavigationTarget } {
  const raw = hashPath(hash);
  const question = raw.indexOf('?');
  if (question < 0) return { path: raw };
  return { path: raw.slice(0, question), target: parseTarget(raw.slice(question + 1)) };
}

function targetQuery(route: Route): string {
  // Aggregate routes may retain a parsed target in memory so a subsequent
  // cross-area navigation can carry it onward, but their own URLs must not
  // advertise or consume Folder + Agent context.
  const target = targetForRoute(route, route.target);
  if (target === undefined) return '';
  const params: string[] = [];
  if (target.instanceId !== undefined) {
    params.push(`instance=${encodeURIComponent(target.instanceId)}`);
  }
  if (target.agentKind !== undefined) {
    params.push(`agent=${encodeURIComponent(target.agentKind)}`);
  }
  return params.length > 0 ? `?${params.join('&')}` : '';
}

/**
 * Parse a `location.hash` into a Route. Unknown or empty hashes fall back to the
 * overview. Gallery sub-paths (`#/gallery/foundation`) stay on the gallery so
 * the committed gallery keeps working.
 */
export function parseRoute(hash: string): Route {
  const { path, target } = routeParts(hash);
  const withTarget = <T extends Route>(route: T): T =>
    target === undefined ? route : ({ ...route, target } as T);
  if (path === '' || path === '/') return withTarget({ name: 'overview' });
  if (path === '/gallery' || path.startsWith('/gallery/')) return withTarget({ name: 'gallery' });
  if (path === '/agents') return withTarget({ name: 'agents' });
  if (path === '/findings') return withTarget({ name: 'findings' });
  if (path === '/artifacts') return withTarget({ name: 'artifacts' });
  if (path === '/instances') return withTarget({ name: 'instances' });
  if (path === '/catalog') return withTarget({ name: 'catalog' });
  if (path === '/extensions') return withTarget({ name: 'extensions' });
  if (path === '/marketplace') return withTarget({ name: 'marketplace' });
  if (path === '/dashboard') return withTarget({ name: 'dashboard' });
  if (path === '/sessions') return withTarget({ name: 'sessions' });
  if (path === '/search') return withTarget({ name: 'search' });
  if (path === '/context') return withTarget({ name: 'context' });
  if (path === '/git') return withTarget({ name: 'git' });
  if (path === '/terminal') return withTarget({ name: 'terminal' });
  if (path === '/pipelines') return withTarget({ name: 'pipelines' });
  for (const name of EDITOR_ROUTES) {
    if (path === `/${name}`) return withTarget({ name });
  }
  const agent = /^\/agent\/([^/]+)$/.exec(path);
  if (agent) {
    const kind = decodePart(agent[1] as string);
    if (kind === undefined || !isSafeAgentKind(kind)) return { name: 'overview' };
    return withTarget({ name: 'agent', kind });
  }
  return { name: 'overview' };
}

/** Canonical hash for a route — used by rail links and programmatic nav. */
export function routeHash(route: Route): string {
  const suffix = targetQuery(route);
  switch (route.name) {
    case 'overview':
      return `#/${suffix}`;
    case 'agent':
      if (!isSafeAgentKind(route.kind)) return '#/';
      return `#/agent/${encodeURIComponent(route.kind)}${suffix}`;
    default:
      return `#/${route.name}${suffix}`;
  }
}
