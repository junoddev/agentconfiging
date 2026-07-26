/**
 * App-state provider — wires the pure reducer (./appState) to the API client and
 * the live-updates WS. This is the single seam the E4 pages (c6p.2-6) plug into:
 * they read data with `useAppState()` / `useReport()` and never touch fetch or
 * the socket directly.
 *
 * LIFECYCLE
 *  1. Bootstrap the token from the URL fragment (once). Missing ⇒ unauthorized.
 *  2. Load the instance list + the default instance's report.
 *  3. Open the WS. A `{type:'report'}` push for the current instance triggers a
 *     refetch (SPEC §4.4 — a real file change → WS push → refetch → UI updates).
 *  4. On unmount, close the socket (no leaks).
 *
 * The socket + client are injectable via `deps` so this composes cleanly and can
 * be exercised without a live server.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError } from '../api/client.js';
import { bootstrapToken } from '../api/token.js';
import type { FileContent, InstanceSummary, Report } from '../api/types.js';
import { WsClient, type WsState } from '../ws/client.js';
import {
  appReducer,
  currentInstance as selectCurrentInstance,
  initialAppState,
  type AppError,
  type AppState,
} from './appState.js';

/** The data + actions every page consumes. */
export interface AppStateValue extends AppState {
  /** The resolved current-instance summary (or undefined before load). */
  currentInstance?: InstanceSummary;
  /** Switch instances; triggers a report fetch for the new instance. */
  selectInstance: (id: string) => void;
  /** Re-fetch the current instance's report (also called on a WS report push). */
  refetch: () => void;
  /** Dismiss a non-fatal error. */
  clearError: () => void;
  /** Fetch one in-scope config file's REDACTED content for the artifact browser
   *  (delegates to the token-bearing client). Rejects when unauthenticated. */
  getFile: (path: string) => Promise<FileContent>;
}

/**
 * Minimal contract the provider needs from the outside world — injectable so a
 * host (or test) can supply a pre-built client and socket.
 */
export interface AppStateDeps {
  client: ApiClient;
  /** Build (but do not yet start) the live WS with the given handlers. */
  makeWs: (handlers: {
    onMessage: (instance: string) => void;
    onState: (state: WsState) => void;
  }) => Pick<WsClient, 'start' | 'close'>;
}

const AppStateContext = createContext<AppStateValue | undefined>(undefined);

function toAppError(err: unknown): AppError {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') {
      return { kind: 'unauthorized', message: 'session token missing or expired' };
    }
    if (err.kind === 'network') {
      return { kind: 'network', message: 'cannot reach the local server' };
    }
    return { kind: 'unknown', message: err.message };
  }
  return { kind: 'unknown', message: String(err) };
}

/**
 * Default deps for production: bootstrap the token, build a real client + WS
 * against the current origin. Returns undefined when no token is present (the
 * provider then renders the unauthorized state instead of connecting).
 */
function defaultDeps(): AppStateDeps | undefined {
  const token = bootstrapToken();
  if (token === undefined) return undefined;
  const client = new ApiClient(token);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`;
  return {
    client,
    makeWs: (handlers) =>
      new WsClient({
        url: wsUrl,
        token,
        onMessage: (msg) => {
          if (msg.type === 'report') handlers.onMessage(msg.instance);
        },
        onState: handlers.onState,
      }),
  };
}

export interface AppStateProviderProps {
  children: ReactNode;
  /** Injected for reuse/testing; production builds real deps from the URL token. */
  deps?: AppStateDeps | null;
}

export function AppStateProvider({ children, deps }: AppStateProviderProps) {
  const [state, dispatch] = useReducer(appReducer, undefined, initialAppState);

  // Resolve deps exactly once. `undefined` (prop omitted) ⇒ build the real ones
  // from the URL token; `null` ⇒ explicitly no deps; a builder returning
  // undefined ⇒ no token. All "no deps" cases normalize to undefined here and
  // render the unauthorized state.
  const resolvedDeps = useMemo(
    () => (deps === undefined ? defaultDeps() : (deps ?? undefined)),
    [deps],
  );

  // Keep the current instance id in a ref so the WS handler + refetch read the
  // latest value without re-subscribing the socket on every selection.
  const currentIdRef = useRef<string | undefined>(state.currentInstanceId);
  currentIdRef.current = state.currentInstanceId;

  const client = resolvedDeps?.client;

  const loadReport = useCallback(
    async (instanceId: string | undefined) => {
      if (!client) return;
      dispatch({ type: 'report:loading' });
      try {
        const report: Report = await client.getReport(instanceId);
        dispatch({ type: 'report:loaded', report });
      } catch (err) {
        dispatch({ type: 'error', error: toAppError(err) });
      }
    },
    [client],
  );

  const refetch = useCallback(() => {
    void loadReport(currentIdRef.current);
  }, [loadReport]);

  const selectInstance = useCallback(
    (id: string) => {
      currentIdRef.current = id;
      dispatch({ type: 'instance:select', id });
      void loadReport(id);
    },
    [loadReport],
  );

  const clearError = useCallback(() => dispatch({ type: 'error:clear' }), []);

  const getFile = useCallback(
    (filePath: string): Promise<FileContent> => {
      if (!client) {
        return Promise.reject(new ApiError(401, 'unauthorized', 'no session'));
      }
      return client.getFile(filePath);
    },
    [client],
  );

  // Boot: no deps ⇒ unauthorized; otherwise load instances + default report and
  // open the socket. Cleanup closes the socket so no handle leaks.
  useEffect(() => {
    if (resolvedDeps === undefined) {
      dispatch({
        type: 'error',
        error: { kind: 'unauthorized', message: 'session token missing' },
      });
      return;
    }
    let cancelled = false;
    const boot = resolvedDeps;

    void (async () => {
      try {
        const instances = await boot.client.getInstances();
        if (cancelled) return;
        dispatch({ type: 'instances:loaded', instances });
        const def = instances.find((i) => i.isDefault) ?? instances[0];
        if (def) currentIdRef.current = def.id;
      } catch (err) {
        if (!cancelled) dispatch({ type: 'error', error: toAppError(err) });
      }
      if (cancelled) return;
      await loadReport(currentIdRef.current);
    })();

    const ws = boot.makeWs({
      onState: (s) => dispatch({ type: 'ws:state', state: s }),
      onMessage: (instance) => {
        // Refetch only when the push targets the instance we're viewing. During
        // the boot window currentIdRef is undefined and the initial loadReport
        // above already covers it, so a push for any instance is ignored until
        // the current instance resolves (then the match is exact).
        if (currentIdRef.current !== undefined && instance === currentIdRef.current) {
          void loadReport(currentIdRef.current);
        }
      },
    });
    ws.start();

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [resolvedDeps, loadReport]);

  const value = useMemo<AppStateValue>(
    () => ({
      ...state,
      currentInstance: selectCurrentInstance(state),
      selectInstance,
      refetch,
      clearError,
      getFile,
    }),
    [state, selectInstance, refetch, clearError, getFile],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

/** Consume the whole app-state value. Must be used under an AppStateProvider. */
export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (value === undefined) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return value;
}

/** Report-focused convenience selector for pages that only need the report. */
export function useReport(): {
  report?: Report;
  loading: boolean;
  error?: AppError;
  refetch: () => void;
} {
  const { report, loading, error, refetch } = useAppState();
  return { report, loading, error, refetch };
}
