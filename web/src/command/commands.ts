/**
 * Command-palette model (DESIGN §6 CommandPalette). Pure + React-free so it is
 * unit-testable: the command list, the fuzzy filter wiring, selection movement,
 * and the global keyboard mapping all live here. The palette component and the
 * App shell consume these and perform the actual effects.
 *
 * The nav command list and the Cmd+1..9 page shortcuts are derived from the real
 * routes (routes.ts) — the settings…sync run comes straight from `EDITOR_ROUTES`,
 * labels come from `ROUTE_LABELS`, and every nav hash round-trips through
 * `parseRoute` (asserted in tests) — so the palette can't drift from the router
 * or the grouped sidebar.
 */

import { EDITOR_ROUTES, ROUTE_LABELS, routeHash, type Route, type RouteName } from '../routes.js';
import {
  navigationMode,
  normalizeNavigationTarget,
  targetForRoute,
  type NavigationTarget,
} from '../navigation.js';
import { fuzzyMatch } from './fuzzy.js';

/** What running a command asks the shell to do. Discriminated so the effectful
 *  half (navigate / flip theme / refetch) stays out of this pure module. */
export type CommandAction =
  { type: 'navigate'; hash: string } | { type: 'toggle-theme' } | { type: 'refetch' };

export interface Command {
  id: string;
  /** Display label (routes.ts label seam — sentence-case nouns). */
  label: string;
  /** Right-aligned mono hint (the target hash, or the command category). */
  hint: string;
  action: CommandAction;
}

/**
 * Sidebar order (mirrors shell/Sidebar.tsx grouping: WORKSPACE / CONFIGURE /
 * LIBRARY / RUNTIME / OPERATE). The settings…sync group is spread from routes'
 * `EDITOR_ROUTES` so that block never drifts. Cmd+1..9 map to the first nine
 * entries.
 */
export const RAIL_ORDER: RouteName[] = [
  // WORKSPACE
  'overview',
  'agents',
  'findings',
  'instances',
  'artifacts',
  // CONFIGURE
  ...EDITOR_ROUTES,
  // LIBRARY
  'catalog',
  'extensions',
  'marketplace',
  // RUNTIME
  'dashboard',
  'sessions',
  'search',
  'context',
  // OPERATE
  'git',
  'terminal',
  'pipelines',
];

/** Display label for a route — reads the routes.ts label seam so the palette
 *  and the sidebar can never drift. */
export function railLabel(name: RouteName): string {
  return ROUTE_LABELS[name];
}

export interface CommandTargetContext {
  contextTarget?: NavigationTarget;
  operateTarget?: NavigationTarget;
}

/**
 * Pick the targets a command list may carry from the current route. Configure
 * and Library consume chooser context. Workspace and Runtime can retain an
 * explicit parsed target in memory for a later Configure/Library hop. Operate
 * targets are only preserved when the current route is already explicitly
 * targeted Operate.
 */
export function commandTargetContext(
  sourceRoute: Route | undefined,
  chooserTarget?: NavigationTarget,
): CommandTargetContext {
  const chooser = normalizeNavigationTarget(chooserTarget);
  if (sourceRoute === undefined) return { contextTarget: chooser };

  const explicitTarget = normalizeNavigationTarget(sourceRoute.target);
  switch (navigationMode(sourceRoute)) {
    case 'workspace':
    case 'runtime':
      return { contextTarget: explicitTarget ?? chooser };
    case 'operate':
      return { contextTarget: chooser, operateTarget: explicitTarget };
    case 'configure':
    case 'library':
      return { contextTarget: chooser };
  }
}

/** Canonical hash for a simple (no-param) route name. */
function navHash(
  name: RouteName,
  contextTarget?: NavigationTarget,
  operateTarget?: NavigationTarget,
): string {
  const route = { name } as Route;
  const target = navigationMode(route) === 'operate' ? operateTarget : contextTarget;
  return routeHash({ ...route, target: targetForRoute(route, target) });
}

/**
 * Hash for the `Cmd+<digit>` page shortcut (1-based), or undefined when the digit
 * is out of the rail's range. Shared with the rail numbering via `RAIL_ORDER`.
 */
export function railShortcutHash(digit: number): string | undefined {
  const name = RAIL_ORDER[digit - 1];
  return name ? navHash(name) : undefined;
}

/**
 * The full command list, given the current theme (so the theme command can name
 * its target). Nav commands first (rail order, then the gallery), then the
 * theme toggle and the refetch action. `hiddenRoutes` (bead a6y) drops nav
 * commands for Configure sections the active agent has no concept of — the
 * palette mirrors the sidebar's adaptive rail. Cmd+1..9 stays on the full
 * RAIL_ORDER so the shortcuts don't renumber per agent.
 */
export function buildCommands(
  theme: 'light' | 'dark',
  hiddenRoutes?: ReadonlySet<RouteName>,
  contextTarget?: NavigationTarget,
  operateTarget?: NavigationTarget,
): Command[] {
  const nav: Command[] = RAIL_ORDER.filter((name) => !hiddenRoutes?.has(name)).map((name) => ({
    id: `nav:${name}`,
    label: railLabel(name),
    hint: navHash(name, contextTarget, operateTarget),
    action: { type: 'navigate', hash: navHash(name, contextTarget, operateTarget) },
  }));
  // The internal gallery is de-emphasized (sidebar bottom) — navigable, but
  // outside Cmd+1..9.
  nav.push({
    id: 'nav:gallery',
    label: railLabel('gallery'),
    hint: navHash('gallery', contextTarget, operateTarget),
    action: { type: 'navigate', hash: navHash('gallery', contextTarget, operateTarget) },
  });

  const actions: Command[] = [
    {
      id: 'theme:toggle',
      label: `Theme → ${theme === 'light' ? 'dark' : 'light'}`,
      hint: 'toggle',
      action: { type: 'toggle-theme' },
    },
    {
      id: 'action:refetch',
      label: 'Refetch report',
      hint: 'action',
      action: { type: 'refetch' },
    },
  ];

  return [...nav, ...actions];
}

export interface ScoredCommand {
  command: Command;
  /** Matched label positions, for optional highlighting. */
  indices: number[];
}

/**
 * Fuzzy-filter + rank a command list against a query. An empty query returns the
 * commands in their natural order; otherwise only subsequence matches survive,
 * best score first (stable on ties by original order).
 */
export function filterCommands(commands: Command[], query: string): ScoredCommand[] {
  const q = query.trim();
  if (q === '') return commands.map((command) => ({ command, indices: [] }));

  const scored: { command: Command; score: number; indices: number[]; order: number }[] = [];
  commands.forEach((command, order) => {
    const m = fuzzyMatch(q, command.label);
    if (m.matched) scored.push({ command, score: m.score, indices: m.indices, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ command, indices }) => ({ command, indices }));
}

/** Wrap-around selection move for arrow-key nav. Empty list clamps to 0. */
export function moveSelection(selected: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (selected + delta + count) % count;
}

/** A minimal keyboard-event shape — keeps the parser pure and easy to test. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** A global shortcut intent, or null when the event isn't one we own. */
export type GlobalIntent = { type: 'open-palette' } | { type: 'goto'; hash: string } | null;

/**
 * Map a global keydown to an intent: the platform modifier + `K` opens the
 * palette; the modifier + `1..9` jumps to the matching rail page. `isMac` picks
 * Cmd (meta) over Ctrl.
 */
export function parseGlobalKey(e: KeyLike, isMac: boolean): GlobalIntent {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  if (e.key === 'k' || e.key === 'K') return { type: 'open-palette' };
  if (e.key >= '1' && e.key <= '9') {
    const hash = railShortcutHash(Number(e.key));
    return hash ? { type: 'goto', hash } : null;
  }
  return null;
}
