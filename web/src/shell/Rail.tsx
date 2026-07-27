/**
 * Left rail navigation (DESIGN §4): fixed 220px, mono micro-labels, numbered
 * `01 SIGNAL / 02 AGENTS / 03 FINDINGS / 04 ARTIFACTS / 05 INSTANCES`. The
 * leading numbers double as `Cmd+1..9` shortcuts (wired in a later bead — here
 * they are rendered only). Nav goes through the hash router. The internal
 * component gallery keeps its own `00` slot below a hairline.
 */

import { routeHash, type Route, type RouteName } from '../routes.js';

interface RailItem {
  /** Two-digit index shown as the mono numeral (doubles as the Cmd shortcut). */
  index: string;
  label: string;
  route: Route;
}

/** Primary E4 inspector sections, in rail order. */
const PRIMARY: RailItem[] = [
  { index: '01', label: 'SIGNAL', route: { name: 'overview' } },
  { index: '02', label: 'AGENTS', route: { name: 'agents' } },
  { index: '03', label: 'FINDINGS', route: { name: 'findings' } },
  { index: '04', label: 'ARTIFACTS', route: { name: 'artifacts' } },
  { index: '05', label: 'INSTANCES', route: { name: 'instances' } },
];

/** E5 config editors, shown below a hairline as a second rail group. */
const EDITORS: RailItem[] = [
  { index: '06', label: 'SETTINGS', route: { name: 'settings' } },
  { index: '07', label: 'INSTRUCTIONS', route: { name: 'instructions' } },
  { index: '08', label: 'SKILLS', route: { name: 'skills' } },
  { index: '09', label: 'HOOKS', route: { name: 'hooks' } },
  { index: '10', label: 'RULES', route: { name: 'rules' } },
  { index: '11', label: 'MEMORY', route: { name: 'memory' } },
  { index: '12', label: 'MCP', route: { name: 'mcp' } },
  { index: '13', label: 'KEYBINDINGS', route: { name: 'keybindings' } },
  { index: '14', label: 'SYNC', route: { name: 'sync' } },
  { index: '15', label: 'CATALOG', route: { name: 'catalog' } },
  { index: '16', label: 'MARKETPLACE', route: { name: 'marketplace' } },
  { index: '17', label: 'DASHBOARD', route: { name: 'dashboard' } },
  { index: '18', label: 'SESSIONS', route: { name: 'sessions' } },
  { index: '19', label: 'ANALYTICS', route: { name: 'analytics' } },
  { index: '20', label: 'SEARCH', route: { name: 'search' } },
  { index: '21', label: 'CONTEXT', route: { name: 'context' } },
];

/** Which rail item owns the active route (agent detail lights up AGENTS). */
function activeSection(route: Route): RouteName {
  if (route.name === 'agent') return 'agents';
  return route.name;
}

function railItem(item: RailItem, active: RouteName) {
  return (
    <a
      key={item.route.name}
      className="micro-label rail__item"
      href={routeHash(item.route)}
      aria-current={item.route.name === active ? 'page' : undefined}
    >
      <span className="rail__index">{item.index}</span> {item.label}
    </a>
  );
}

export function Rail({ route }: { route: Route }) {
  const active = activeSection(route);
  return (
    <nav className="rail" aria-label="Sections">
      {PRIMARY.map((item) => railItem(item, active))}
      <hr className="rule-h rail__break" />
      {EDITORS.map((item) => railItem(item, active))}
      <hr className="rule-h rail__break" />
      {railItem({ index: '00', label: 'GALLERY', route: { name: 'gallery' } }, active)}
    </nav>
  );
}
