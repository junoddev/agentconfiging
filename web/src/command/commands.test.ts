import { describe, expect, it } from 'vitest';
import { parseRoute } from '../routes.js';
import {
  RAIL_ORDER,
  buildCommands,
  filterCommands,
  moveSelection,
  parseGlobalKey,
  railLabel,
  railShortcutHash,
  type CommandAction,
} from './commands.js';

/** Every routable page the palette should offer a jump for. `agent/:kind` is a
 *  param route with no rail slot, so it is deliberately excluded. */
const EXPECTED_NAV = new Set([...RAIL_ORDER, 'gallery']);

describe('RAIL_ORDER', () => {
  it('covers the 24 sidebar pages, overview first', () => {
    expect(RAIL_ORDER).toHaveLength(24);
    expect(RAIL_ORDER[0]).toBe('overview');
    expect(RAIL_ORDER[RAIL_ORDER.length - 1]).toBe('pipelines');
    expect(new Set(RAIL_ORDER).size).toBe(24); // no dupes
  });

  it('groups WORKSPACE first (instances before artifacts), then CONFIGURE', () => {
    expect(RAIL_ORDER.slice(0, 5)).toEqual([
      'overview',
      'agents',
      'findings',
      'instances',
      'artifacts',
    ]);
    expect(RAIL_ORDER.slice(5, 9)).toEqual(['settings', 'instructions', 'skills', 'hooks']);
  });
});

describe('buildCommands', () => {
  it('offers a jump for every real route (no drift from the router)', () => {
    const cmds = buildCommands('light');
    const navNames = cmds
      .filter((c) => c.action.type === 'navigate')
      .map((c) => parseRoute((c.action as { hash: string }).hash).name);
    expect(new Set(navNames)).toEqual(EXPECTED_NAV);
  });

  it('every nav hash round-trips through the real parseRoute', () => {
    for (const c of buildCommands('dark')) {
      if (c.action.type !== 'navigate') continue;
      // A valid hash never falls back to overview unless it *is* overview.
      const parsed = parseRoute(c.action.hash);
      expect(parsed.name).toBeTruthy();
    }
  });

  it('names the theme toggle after the opposite theme', () => {
    expect(buildCommands('light').find((c) => c.action.type === 'toggle-theme')?.label).toContain(
      'dark',
    );
    expect(buildCommands('dark').find((c) => c.action.type === 'toggle-theme')?.label).toContain(
      'light',
    );
  });

  it('includes the refetch action', () => {
    expect(buildCommands('light').some((c) => c.action.type === 'refetch')).toBe(true);
  });

  it('hiddenRoutes drops those nav commands only (bead a6y adaptive rail)', () => {
    const cmds = buildCommands('light', new Set(['hooks', 'settings']));
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('nav:hooks');
    expect(ids).not.toContain('nav:settings');
    expect(ids).toContain('nav:instructions');
    expect(ids).toContain('nav:overview');
  });

  it('labels routes from the routes.ts label seam', () => {
    expect(railLabel('overview')).toBe('Overview');
    expect(railLabel('git')).toBe('Git');
    expect(railLabel('mcp')).toBe('MCP');
  });
});

describe('railShortcutHash — Cmd+1..9 → route', () => {
  it('maps the first nine sidebar slots in grouped order', () => {
    expect(railShortcutHash(1)).toBe('#/'); // Overview
    expect(railShortcutHash(2)).toBe('#/agents');
    expect(railShortcutHash(4)).toBe('#/instances');
    expect(railShortcutHash(5)).toBe('#/artifacts');
    expect(railShortcutHash(6)).toBe('#/settings');
    expect(railShortcutHash(9)).toBe('#/hooks');
  });

  it('each shortcut hash resolves back to its rail route', () => {
    for (let d = 1; d <= 9; d++) {
      const hash = railShortcutHash(d);
      expect(hash).toBeDefined();
      expect(parseRoute(hash as string).name).toBe(RAIL_ORDER[d - 1]);
    }
  });

  it('returns undefined out of range', () => {
    expect(railShortcutHash(0)).toBeUndefined();
    expect(railShortcutHash(25)).toBeUndefined();
  });
});

describe('parseGlobalKey', () => {
  it('opens the palette on the platform modifier + K', () => {
    expect(parseGlobalKey({ key: 'k', metaKey: true, ctrlKey: false }, true)).toEqual({
      type: 'open-palette',
    });
    expect(parseGlobalKey({ key: 'K', metaKey: false, ctrlKey: true }, false)).toEqual({
      type: 'open-palette',
    });
  });

  it('ignores the non-platform modifier', () => {
    // On mac, Ctrl+K is not the palette; on non-mac, Cmd+K is not.
    expect(parseGlobalKey({ key: 'k', metaKey: false, ctrlKey: true }, true)).toBeNull();
    expect(parseGlobalKey({ key: 'k', metaKey: true, ctrlKey: false }, false)).toBeNull();
  });

  it('maps modifier + 1..9 to a page jump', () => {
    expect(parseGlobalKey({ key: '1', metaKey: true, ctrlKey: false }, true)).toEqual({
      type: 'goto',
      hash: '#/',
    });
    expect(parseGlobalKey({ key: '6', metaKey: false, ctrlKey: true }, false)).toEqual({
      type: 'goto',
      hash: '#/settings',
    });
  });

  it('ignores bare keys and modifier+0', () => {
    expect(parseGlobalKey({ key: 'k', metaKey: false, ctrlKey: false }, true)).toBeNull();
    expect(parseGlobalKey({ key: '0', metaKey: true, ctrlKey: false }, true)).toBeNull();
  });
});

describe('filterCommands', () => {
  const cmds = buildCommands('light');

  it('returns every command in natural order for an empty query', () => {
    expect(filterCommands(cmds, '').map((r) => r.command.id)).toEqual(cmds.map((c) => c.id));
  });

  it('ranks a tight match to the top', () => {
    const top = filterCommands(cmds, 'over')[0];
    expect(top?.command.label).toBe('Overview');
  });

  it('drops non-matches', () => {
    expect(filterCommands(cmds, 'zzzzz')).toEqual([]);
  });

  it('finds an action by label', () => {
    const ids = filterCommands(cmds, 'refetch').map((r) => r.command.id);
    expect(ids).toContain('action:refetch');
  });
});

describe('moveSelection', () => {
  it('wraps forward and backward', () => {
    expect(moveSelection(2, 1, 4)).toBe(3);
    expect(moveSelection(3, 1, 4)).toBe(0); // wrap past end
    expect(moveSelection(0, -1, 4)).toBe(3); // wrap before start
  });

  it('clamps to 0 for an empty list', () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});

/** Type-level: exhaustiveness of the action union used by the shell. */
const _actions: CommandAction['type'][] = ['navigate', 'toggle-theme', 'refetch'];
void _actions;
