/** Hash-based routing — deliberately no router dependency (DESIGN §4). The E4
 *  Inspector routes plus the internal component gallery. `agent/:kind` carries a
 *  param, so a Route is a small discriminated union rather than a bare string. */

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
  | 'marketplace'
  | 'dashboard'
  | 'sessions'
  | 'search'
  | 'context'
  | 'git'
  | 'terminal'
  | 'pipelines'
  | 'gallery';

export type Route = { name: Exclude<RouteName, 'agent'> } | { name: 'agent'; kind: string };

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
  instances: 'Instances',
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
  if (path === '/catalog') return { name: 'catalog' };
  if (path === '/marketplace') return { name: 'marketplace' };
  if (path === '/dashboard') return { name: 'dashboard' };
  if (path === '/sessions') return { name: 'sessions' };
  if (path === '/search') return { name: 'search' };
  if (path === '/context') return { name: 'context' };
  if (path === '/git') return { name: 'git' };
  if (path === '/terminal') return { name: 'terminal' };
  if (path === '/pipelines') return { name: 'pipelines' };
  for (const name of EDITOR_ROUTES) {
    if (path === `/${name}`) return { name };
  }
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
