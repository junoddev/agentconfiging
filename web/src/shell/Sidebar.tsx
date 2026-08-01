/**
 * Sidebar (opendesign/DESIGN.md §4/§5): 232px, `--surface`, right hairline.
 * Grouped nav — WORKSPACE / CONFIGURE / LIBRARY / RUNTIME / OPERATE — of
 * `.nav-item`s (mono glyph, sans label, mono count pushed right; active =
 * accent-soft bg + 2px accent left bar). Labels come from the routes.ts
 * `ROUTE_LABELS` seam (shared with the command palette) and the group order
 * mirrors `RAIL_ORDER` in command/commands.ts — the three nav seams move
 * together. The internal gallery sits de-emphasized at the bottom; the scope
 * legend (`.side-legend`) is pinned below it.
 */

import { sourceBadgeText } from '../components/core/index.js';
import { ROUTE_LABELS, routeHash, type Route, type RouteName } from '../routes.js';
import { isGlobalEntryError } from '../api/types.js';
import { sectionApplies, useAppState, type ConfigSection } from '../state/index.js';
import { useConfigureCounts, type ConfigureCountKey } from './useConfigureCounts.js';

/** A no-param route name (every nav target; `agent/:kind` has no nav slot). */
type NavRouteName = Exclude<RouteName, 'agent'>;

/** Count keys the sidebar can render against a nav item: the cheap Workspace
 *  ones (straight off the report) plus every Configure section (see
 *  useConfigureCounts — those mix report-derived and fetched sources). */
type CountKey = 'findings' | 'agents' | 'instances' | ConfigureCountKey;

interface NavItem {
  name: NavRouteName;
  /** Mono glyph in the 15px box (decorative — DESIGN forbids emoji icons). */
  glyph: string;
  /** Count key rendered mono, pushed right. */
  count?: CountKey;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Grouping per E13.3 — mirrors RAIL_ORDER (command/commands.ts). */
const GROUPS: NavGroup[] = [
  {
    group: 'Workspace',
    items: [
      { name: 'overview', glyph: '◈' },
      { name: 'agents', glyph: '⊙', count: 'agents' },
      { name: 'findings', glyph: '△', count: 'findings' },
      { name: 'instances', glyph: '⊞', count: 'instances' },
      { name: 'artifacts', glyph: '⧉' },
    ],
  },
  {
    group: 'Configure',
    items: [
      { name: 'settings', glyph: '≡', count: 'settings' },
      { name: 'instructions', glyph: '¶', count: 'instructions' },
      { name: 'skills', glyph: '✦', count: 'skills' },
      { name: 'hooks', glyph: '⚑', count: 'hooks' },
      { name: 'rules', glyph: '§', count: 'rules' },
      { name: 'memory', glyph: '▤', count: 'memory' },
      { name: 'mcp', glyph: '⌁', count: 'mcp' },
      { name: 'keybindings', glyph: '⌘', count: 'keybindings' },
      { name: 'sync', glyph: '⇅', count: 'sync' },
    ],
  },
  {
    group: 'Library',
    items: [
      { name: 'catalog', glyph: '▦' },
      { name: 'extensions', glyph: '⊕' },
      { name: 'marketplace', glyph: '◫' },
    ],
  },
  {
    group: 'Runtime',
    items: [
      { name: 'dashboard', glyph: '◔' },
      { name: 'sessions', glyph: '❯' },
      { name: 'search', glyph: '⌕' },
      { name: 'context', glyph: '◎' },
    ],
  },
  {
    group: 'Operate',
    items: [
      { name: 'git', glyph: '⎇' },
      { name: 'terminal', glyph: '❒' },
      { name: 'pipelines', glyph: '⋙' },
    ],
  },
];

/** Which nav item owns the active route (agent detail lights up AGENTS). */
function activeSection(route: Route): RouteName {
  if (route.name === 'agent') return 'agents';
  return route.name;
}

export function Sidebar({ route }: { route: Route }) {
  const { report, instances, globalReport, currentInstance, agentScopeKind } = useAppState();
  const active = activeSection(route);
  const configureCounts = useConfigureCounts();

  const counts: Record<NonNullable<NavItem['count']>, number | undefined> = {
    findings: report?.findings.length,
    agents: report?.agents.length,
    instances: instances.length > 0 ? instances.length : undefined,
    ...configureCounts,
  };

  // Legend paths: real data where we have it (global scan root, instance root);
  // the LOCAL row names the conventional overlay file the badge refers to.
  const globalRoot =
    globalReport?.entries.find((e) => !isGlobalEntryError(e) && e.dir === '.claude')?.root ??
    globalReport?.entries[0]?.root;

  const navItem = ({ name, glyph, count }: NavItem) => {
    const isActive = name === active;
    const n = count === undefined ? undefined : counts[count];
    return (
      <a
        key={name}
        className={`nav-item${isActive ? ' active' : ''}`}
        href={routeHash({ name })}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="glyph" aria-hidden="true">
          {glyph}
        </span>
        {ROUTE_LABELS[name]}
        {n !== undefined && <span className="count">{n}</span>}
      </a>
    );
  };

  return (
    <nav className="sidebar" aria-label="Sections">
      {GROUPS.map(({ group, items }) => {
        // Configure adapts to the ACTIVE agent (bead a6y): sections the runtime
        // has no concept of (e.g. Hooks for Codex) are removed, not zeroed.
        const visible =
          group === 'Configure'
            ? items.filter((i) => sectionApplies(i.name as ConfigSection, agentScopeKind))
            : items;
        return (
          <div key={group} className="side-group">
            <div className="nav-group">{group}</div>
            {visible.map(navItem)}
          </div>
        );
      })}
      {/* Internal component gallery — reachable, deliberately de-emphasized. */}
      <div className="side-dev">{navItem({ name: 'gallery', glyph: '◧' })}</div>
      <div className="side-legend">
        <div className="lg-row">
          <span className="scope s-global source-badge">{sourceBadgeText('global')}</span>
          <span className="lg-path">{globalRoot ?? '~'}</span>
        </div>
        <div className="lg-row">
          <span className="scope s-project source-badge">{sourceBadgeText('project')}</span>
          <span className="lg-path">{currentInstance?.root ?? '—'}</span>
        </div>
        <div className="lg-row">
          <span className="scope s-local source-badge">{sourceBadgeText('local')}</span>
          <span className="lg-path">.claude/settings.local.json</span>
        </div>
      </div>
    </nav>
  );
}
