import { describe, expect, it } from 'vitest';
import {
  chooserVisibility,
  isChooserVisible,
  navigationMode,
  navigationScope,
  normalizeNavigationTarget,
  resolveExplicitOperateTarget,
  targetForRoute,
  type NavigationMode,
} from './navigation.js';
import { EDITOR_ROUTES, type RouteName } from './routes.js';

const modeRoutes: Record<NavigationMode, RouteName[]> = {
  workspace: ['overview', 'agents', 'agent', 'findings', 'artifacts', 'instances'],
  configure: [...EDITOR_ROUTES],
  library: ['catalog', 'extensions', 'marketplace'],
  runtime: ['dashboard', 'sessions', 'search', 'context'],
  operate: ['git', 'terminal', 'pipelines'],
};

describe('navigationMode', () => {
  it('classifies every rail area and agent detail', () => {
    for (const [mode, routes] of Object.entries(modeRoutes) as [NavigationMode, RouteName[]][]) {
      for (const name of routes) expect(navigationMode({ name } as { name: RouteName })).toBe(mode);
    }
  });
});

describe('chooser visibility', () => {
  it('shows Folder + Agent only for Configure and Library', () => {
    expect(isChooserVisible('configure')).toBe(true);
    expect(isChooserVisible('library')).toBe(true);
    for (const mode of ['workspace', 'runtime', 'operate'] as const) {
      expect(isChooserVisible(mode)).toBe(false);
      expect(chooserVisibility(mode)).toEqual({ folder: false, agent: false });
    }
    expect(chooserVisibility('configure')).toEqual({ folder: true, agent: true });
  });
});

describe('navigationScope', () => {
  const target = { instanceId: 'inst-1', agentKind: 'claude-code' };

  it('uses config context in Configure and Library', () => {
    expect(navigationScope({ name: 'settings' }, target)).toEqual({
      mode: 'configure',
      context: target,
    });
    expect(navigationScope({ name: 'catalog' }, target)).toEqual({
      mode: 'library',
      context: target,
    });
  });

  it('keeps Workspace and Runtime aggregate and page-local', () => {
    expect(navigationScope({ name: 'findings' }, target, 'errors')).toEqual({
      mode: 'workspace',
      aggregate: true,
      filter: 'errors',
    });
    expect(navigationScope({ name: 'search' }, target, 'tool')).toEqual({
      mode: 'runtime',
      aggregate: true,
      filter: 'tool',
    });
  });

  it('uses an explicit optional target in Operate', () => {
    expect(navigationScope({ name: 'terminal' }, target)).toEqual({
      mode: 'operate',
      target,
    });
    expect(navigationScope({ name: 'git' })).toEqual({ mode: 'operate' });
  });

  it('does not leak aggregate targets or configuration into unrelated modes', () => {
    expect(targetForRoute({ name: 'findings' }, target)).toBeUndefined();
    expect(targetForRoute({ name: 'dashboard' }, target)).toBeUndefined();
    expect(targetForRoute({ name: 'git' }, target)).toEqual(target);
  });
});

describe('normalizeNavigationTarget', () => {
  it('defaults absent and empty targets safely', () => {
    expect(normalizeNavigationTarget(undefined)).toBeUndefined();
    expect(normalizeNavigationTarget({})).toBeUndefined();
    expect(normalizeNavigationTarget({ instanceId: '' })).toBeUndefined();
  });

  it('rejects malformed and unsafe target values', () => {
    expect(normalizeNavigationTarget({ instanceId: '../etc' })).toBeUndefined();
    expect(normalizeNavigationTarget({ instanceId: 'id with spaces' })).toBeUndefined();
    expect(normalizeNavigationTarget({ agentKind: '../claude' })).toBeUndefined();
    expect(normalizeNavigationTarget({ agentKind: 'claude//code' })).toBeUndefined();
  });
});

describe('resolveExplicitOperateTarget', () => {
  const instances = [
    { id: 'default', name: 'Default', root: '/repo/default' },
    { id: 'other', name: 'Other', root: '/repo/other' },
  ];

  it('applies a known deep-link instance and keeps its explicit agent', () => {
    expect(
      resolveExplicitOperateTarget({ instanceId: 'other', agentKind: 'codex' }, instances),
    ).toEqual({
      state: 'ready',
      target: { instanceId: 'other', agentKind: 'codex' },
      instance: instances[1],
      instances,
    });
  });

  it('blocks an unknown instance instead of falling back to the Configure selection', () => {
    expect(resolveExplicitOperateTarget({ instanceId: 'missing' }, instances)).toEqual({
      state: 'invalid',
      requested: { instanceId: 'missing' },
      instances,
    });
  });

  it('requires an explicit instance target even when an agent target is present', () => {
    expect(resolveExplicitOperateTarget({ agentKind: 'codex' }, instances)).toEqual({
      state: 'missing',
      instances,
    });
  });
});
