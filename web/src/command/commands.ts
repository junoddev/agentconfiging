/**
 * Command-palette model (DESIGN §6 CommandPalette). Pure + React-free so it is
 * unit-testable: the command list, the fuzzy filter wiring, selection movement,
 * and the global keyboard mapping all live here. The palette component and the
 * App shell consume these and perform the actual effects.
 *
 * The nav command list and the Cmd+1..9 page shortcuts are derived from the real
 * routes (routes.ts) — the settings…sync run comes straight from `EDITOR_ROUTES`
 * and every nav hash round-trips through `parseRoute` (asserted in tests) — so
 * the palette can't drift from the router or the numbered rail.
 */

import { EDITOR_ROUTES, routeHash, type Route, type RouteName } from '../routes.js';
import { fuzzyMatch } from './fuzzy.js';

/** What running a command asks the shell to do. Discriminated so the effectful
 *  half (navigate / flip theme / refetch) stays out of this pure module. */
export type CommandAction =
  { type: 'navigate'; hash: string } | { type: 'toggle-theme' } | { type: 'refetch' };

export interface Command {
  id: string;
  /** Display label (Signal Grid all-caps). */
  label: string;
  /** Right-aligned mono hint (the target hash, or the command category). */
  hint: string;
  action: CommandAction;
}

/**
 * Rail order 01..24 (mirrors shell/Rail.tsx, which owns the rendered rail). The
 * settings…sync group is spread from routes' `EDITOR_ROUTES` so that block never
 * drifts. Cmd+1..9 map to the first nine entries (shared with the rail numbers).
 */
export const RAIL_ORDER: RouteName[] = [
  'overview',
  'agents',
  'findings',
  'artifacts',
  'instances',
  ...EDITOR_ROUTES,
  'catalog',
  'marketplace',
  'dashboard',
  'sessions',
  'analytics',
  'search',
  'context',
  'git',
  'terminal',
  'pipelines',
];

/** Labels where the rail text isn't just the upper-cased route name. */
const LABEL_OVERRIDE: Partial<Record<RouteName, string>> = {
  overview: 'SIGNAL',
};

export function railLabel(name: RouteName): string {
  return LABEL_OVERRIDE[name] ?? name.toUpperCase();
}

/** Canonical hash for a simple (no-param) route name. */
function navHash(name: RouteName): string {
  return routeHash({ name } as Route);
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
 * its target). Nav commands first (rail order, then the `00` gallery), then the
 * theme toggle and the refetch action.
 */
export function buildCommands(theme: 'paper' | 'ink'): Command[] {
  const nav: Command[] = RAIL_ORDER.map((name) => ({
    id: `nav:${name}`,
    label: railLabel(name),
    hint: navHash(name),
    action: { type: 'navigate', hash: navHash(name) },
  }));
  // The internal gallery is rail slot `00` — navigable, but outside Cmd+1..9.
  nav.push({
    id: 'nav:gallery',
    label: 'GALLERY',
    hint: navHash('gallery'),
    action: { type: 'navigate', hash: navHash('gallery') },
  });

  const actions: Command[] = [
    {
      id: 'theme:toggle',
      label: `THEME → ${theme === 'paper' ? 'INK' : 'PAPER'}`,
      hint: 'TOGGLE',
      action: { type: 'toggle-theme' },
    },
    {
      id: 'action:refetch',
      label: 'REFETCH REPORT',
      hint: 'ACTION',
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
