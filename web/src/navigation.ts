/**
 * Pure navigation model for the five product rail areas.
 *
 * The top-bar Folder + Agent chooser is a CONFIGURE/LIBRARY control. Workspace
 * and Runtime pages are aggregate views (with their own page-local filters),
 * while Operate pages are addressed by an explicit instance/agent target. The
 * model is deliberately independent of React, the DOM, and AppState so route
 * links can carry context without turning the chooser into global state.
 */

import type { Route, RouteName } from './routes.js';

export type NavigationMode = 'workspace' | 'configure' | 'library' | 'runtime' | 'operate';

/** A serializable target. Undefined fields mean "use the mode's default". */
export interface NavigationTarget {
  /** Opaque instance id; absent means the server/default instance. */
  instanceId?: string;
  /** Detected agent kind; absent means the page's agent default. */
  agentKind?: string;
}

export interface AggregateNavigationState {
  mode: 'workspace' | 'runtime';
  aggregate: true;
  /** Page-local filter state; never interpreted as Folder + Agent config context. */
  filter?: string;
}

export type NavigationScope =
  | { mode: 'configure' | 'library'; context: NavigationTarget }
  | AggregateNavigationState
  | { mode: 'operate'; target?: NavigationTarget };

export interface OperateTargetInstance {
  id: string;
  name: string;
  root?: string;
}

export type OperateTargetResolution =
  | { state: 'missing'; instances: OperateTargetInstance[] }
  | {
      state: 'invalid';
      requested: NavigationTarget;
      instances: OperateTargetInstance[];
    }
  | {
      state: 'ready';
      target: NavigationTarget & { instanceId: string };
      instance: OperateTargetInstance;
      instances: OperateTargetInstance[];
    };

const ROUTE_MODES: Record<Exclude<RouteName, 'agent'>, NavigationMode> = {
  overview: 'workspace',
  agents: 'workspace',
  profiles: 'workspace',
  findings: 'workspace',
  artifacts: 'workspace',
  instances: 'workspace',
  settings: 'configure',
  instructions: 'configure',
  skills: 'configure',
  hooks: 'configure',
  rules: 'configure',
  memory: 'configure',
  mcp: 'configure',
  keybindings: 'configure',
  sync: 'configure',
  catalog: 'library',
  extensions: 'library',
  marketplace: 'library',
  dashboard: 'runtime',
  sessions: 'runtime',
  search: 'runtime',
  context: 'runtime',
  git: 'operate',
  terminal: 'operate',
  pipelines: 'operate',
  // Gallery is not a rail item, but treating it as Library keeps its chooser
  // behavior deterministic for deep links and development builds.
  gallery: 'library',
};

/** Return the rail mode for a route; agent detail belongs to Workspace. */
export function navigationMode(route: Pick<Route, 'name'>): NavigationMode {
  return route.name === 'agent' ? 'workspace' : ROUTE_MODES[route.name];
}

/** The chooser is shown only where configuration context is meaningful. */
export function isChooserVisible(routeOrMode: Pick<Route, 'name'> | NavigationMode): boolean {
  const mode = typeof routeOrMode === 'string' ? routeOrMode : navigationMode(routeOrMode);
  return mode === 'configure' || mode === 'library';
}

/** Explicit visibility for the two chooser halves, useful to shell callers. */
export function chooserVisibility(routeOrMode: Pick<Route, 'name'> | NavigationMode): {
  folder: boolean;
  agent: boolean;
} {
  const visible = isChooserVisible(routeOrMode);
  return { folder: visible, agent: visible };
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export function isSafeAgentKind(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(value)) {
    return false;
  }
  // Agent kinds may contain an encoded slash for legacy deep links, but never
  // path traversal or empty path segments.
  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/**
 * Validate and copy a target. Invalid, empty, or unsafe targets resolve to
 * undefined, which means the mode's documented default (default instance,
 * page-local aggregate, or untargeted Operate state).
 */
export function normalizeNavigationTarget(
  target: NavigationTarget | undefined,
): NavigationTarget | undefined {
  if (target === undefined) return undefined;
  const hasInstance = target.instanceId !== undefined;
  const hasAgent = target.agentKind !== undefined;
  if ((!hasInstance && !hasAgent) || (hasInstance && !validId(target.instanceId))) return undefined;
  if (hasAgent && !isSafeAgentKind(target.agentKind)) return undefined;
  return {
    ...(hasInstance ? { instanceId: target.instanceId } : {}),
    ...(hasAgent ? { agentKind: target.agentKind } : {}),
  };
}

/**
 * Apply the route's scope semantics. Configuration context is ignored by
 * aggregate modes; this is the guard against leaking the top chooser into
 * Workspace or Runtime. Operate deliberately exposes an optional explicit
 * target instead of silently reading configuration context.
 */
export function navigationScope(
  route: Pick<Route, 'name'>,
  target?: NavigationTarget,
  filter?: string,
): NavigationScope {
  const mode = navigationMode(route);
  const normalized = normalizeNavigationTarget(target);
  switch (mode) {
    case 'configure':
    case 'library':
      return { mode, context: normalized ?? {} };
    case 'workspace':
    case 'runtime':
      return { mode, aggregate: true, ...(filter !== undefined ? { filter } : {}) };
    case 'operate':
      return { mode, ...(normalized !== undefined ? { target: normalized } : {}) };
  }
}

/** Keep a target only for routes whose semantics consume it. */
export function targetForRoute(
  route: Pick<Route, 'name'>,
  target: NavigationTarget | undefined,
): NavigationTarget | undefined {
  const mode = navigationMode(route);
  return mode === 'configure' || mode === 'library' || mode === 'operate'
    ? normalizeNavigationTarget(target)
    : undefined;
}

/**
 * Resolve an Operate target without consulting Configure/Library chooser state.
 *
 * Operational pages must name the instance they affect before issuing privileged
 * actions. A syntactically invalid target, an absent target, or a target whose
 * instance disappeared is a blocked state the page can render explicitly.
 */
export function resolveExplicitOperateTarget(
  target: NavigationTarget | undefined,
  instances: readonly OperateTargetInstance[],
): OperateTargetResolution {
  const normalized = normalizeNavigationTarget(target);
  if (normalized?.instanceId === undefined) {
    return { state: 'missing', instances: [...instances] };
  }
  const instance = instances.find((item) => item.id === normalized.instanceId);
  if (instance === undefined) {
    return { state: 'invalid', requested: normalized, instances: [...instances] };
  }
  return {
    state: 'ready',
    target: {
      instanceId: instance.id,
      ...(normalized.agentKind !== undefined ? { agentKind: normalized.agentKind } : {}),
    },
    instance,
    instances: [...instances],
  };
}
