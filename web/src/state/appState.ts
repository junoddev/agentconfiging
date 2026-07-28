/**
 * App-state model — the pure reducer the shell and every E4 page share. Kept
 * free of React and I/O so it is unit-testable in isolation; the provider
 * (./AppStateContext) wires it to the API + WS layers.
 *
 * State the pages consume:
 *   instances        — the hosted instance list (workspace switcher)
 *   currentInstanceId — the selected instance (undefined ⇒ server default)
 *   report           — the current instance's content-free report
 *   wsState          — live-watcher connection state (drives the LIVE dot)
 *   loading          — a report fetch is in flight
 *   error            — a fatal-to-the-view error (unauthorized shows a re-launch
 *                      prompt; others are surfaced but non-crashing)
 *   globalReport / globalLoading / globalError — the machine-global (inherited
 *                      config) slice (bead 71h.3). Instance-independent and
 *                      CONFINED: a global fetch failure lands in `globalError`
 *                      only, never in `error` (the shell reacts only to `error`).
 */

import type { GlobalReport, InstanceSummary, Report } from '../api/types.js';
import type { WsState } from '../ws/client.js';

export type AppErrorKind = 'unauthorized' | 'network' | 'unknown';

export interface AppError {
  kind: AppErrorKind;
  message: string;
}

export interface AppState {
  instances: InstanceSummary[];
  currentInstanceId?: string;
  report?: Report;
  wsState: WsState;
  loading: boolean;
  error?: AppError;
  globalReport?: GlobalReport;
  globalLoading: boolean;
  globalError?: AppError;
}

export type AppAction =
  /** A report fetch has begun (spinner-free: pages show the prior report + a sweep). */
  | { type: 'report:loading' }
  /** The instance list arrived. */
  | { type: 'instances:loaded'; instances: InstanceSummary[] }
  /** A report arrived for the current instance. */
  | { type: 'report:loaded'; report: Report }
  /** The user (or WS) selected an instance; clears the stale report. */
  | { type: 'instance:select'; id: string }
  /** WS connection state changed. */
  | { type: 'ws:state'; state: WsState }
  /** A fatal-to-view error. */
  | { type: 'error'; error: AppError }
  /** Dismiss a non-fatal error. */
  | { type: 'error:clear' }
  /** A machine-global report fetch has begun (fires alongside boot, non-blocking). */
  | { type: 'global:loading' }
  /** The machine-global report arrived. */
  | { type: 'global:loaded'; report: GlobalReport }
  /** The global fetch failed — confined to the global slice, never `error`. */
  | { type: 'global:error'; error: AppError };

export function initialAppState(): AppState {
  return { instances: [], wsState: 'offline', loading: false, globalLoading: false };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'report:loading':
      return { ...state, loading: true };
    case 'instances:loaded':
      return { ...state, instances: action.instances };
    case 'report:loaded':
      // A successful report clears any prior error and marks the instance loaded.
      return {
        ...state,
        report: action.report,
        loading: false,
        error: undefined,
      };
    case 'instance:select':
      if (action.id === state.currentInstanceId) return state;
      // Drop the stale report so pages don't show another instance's data.
      return { ...state, currentInstanceId: action.id, report: undefined, loading: true };
    case 'ws:state':
      if (action.state === state.wsState) return state;
      return { ...state, wsState: action.state };
    case 'error':
      return { ...state, loading: false, error: action.error };
    case 'error:clear':
      return { ...state, error: undefined };
    case 'global:loading':
      return { ...state, globalLoading: true };
    case 'global:loaded':
      return {
        ...state,
        globalReport: action.report,
        globalLoading: false,
        globalError: undefined,
      };
    case 'global:error':
      // Confined: the project view's `error` is deliberately untouched.
      return { ...state, globalLoading: false, globalError: action.error };
    default:
      return state;
  }
}

/** The currently-selected instance summary, or undefined when none resolved. */
export function currentInstance(state: AppState): InstanceSummary | undefined {
  const byId = state.currentInstanceId
    ? state.instances.find((i) => i.id === state.currentInstanceId)
    : undefined;
  return byId ?? state.instances.find((i) => i.isDefault);
}
