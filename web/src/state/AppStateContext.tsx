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
import { isGlobalEntryError } from '../api/types.js';
import type {
  ApplyFixResponse,
  DetectedAgent,
  FileContent,
  GlobalEntry,
  GlobalEntryError,
  GlobalReport,
  HookEditRequest,
  InstanceSummary,
  Report,
  WriteResponse,
} from '../api/types.js';
import { WsClient, type WsState } from '../ws/client.js';
import {
  availableAgents as collectAvailableAgents,
  readStoredAgentKind,
  resolveActiveAgent,
  writeStoredAgentKind,
} from './agentScope.js';
import {
  appReducer,
  currentInstance as selectCurrentInstance,
  initialAppState,
  type AppError,
  type AppState,
} from './appState.js';

/** The data + actions every page consumes. */
export interface AppStateValue extends AppState {
  /** The token-bearing API client, or undefined when unauthenticated. Exposed so
   *  pages needing endpoints the provider does not wrap (storage, scan, known
   *  projects, sync dry-runs) inherit the SAME injectable client instead of
   *  bootstrapping a private one (bead — restores test injectability). */
  client?: ApiClient;
  /** The resolved current-instance summary (or undefined before load). */
  currentInstance?: InstanceSummary;
  /** The EFFECTIVE active agent (bead a6y): the picked kind when this report
   *  detected it, else the first detection. Global detections are included so
   *  the picker remains usable for folders with no local agent config. */
  activeAgent?: DetectedAgent;
  /** Project plus machine-global runtime detections, de-duplicated by kind. */
  availableAgents: DetectedAgent[];
  /** Runtime scope for page data. Undefined when the selected runtime exists
   *  only globally, so project config and all global overlays remain visible. */
  agentScopeKind?: string;
  /** Switch instances; triggers a report fetch for the new instance. */
  selectInstance: (id: string) => void;
  /** Re-fetch the instance list into the shared state so the top-bar FOLDER
   *  chooser reflects adds/removes made on the Instances page. Best-effort: a
   *  failure leaves the prior list in place. */
  refreshInstances: () => Promise<void>;
  /** Pick the active Configure agent; persisted across reloads. */
  selectAgent: (kind: string) => void;
  /** Re-fetch the current instance's report (also called on a WS report push). */
  refetch: () => void;
  /** Re-fetch the machine-global report (bead 71h.3). Manual only — WS pushes
   *  never target the global scope (no global watcher yet; bead 71h.7). */
  refetchGlobal: () => void;
  /** Dismiss a non-fatal error. */
  clearError: () => void;
  /** Fetch one in-scope config file's REDACTED content for the artifact browser
   *  (delegates to the token-bearing client). Rejects when unauthenticated. */
  getFile: (path: string) => Promise<FileContent>;
  /**
   * WRITE FLOW (bead wmc.1) — the seam the reusable `useWriteFlow` hook drives.
   * `applyFix` dry-runs/commits a finding's machine fix against the CURRENT
   * instance; `writeFile` writes an editor's proposed content. Both reject when
   * unauthenticated. After a commit, callers refetch() to pull the fresh report.
   */
  applyFix: (findingId: string, opts: { dryRun: boolean }) => Promise<ApplyFixResponse>;
  writeFile: (path: string, content: string, dryRun: boolean) => Promise<WriteResponse>;
  /** STRUCTURED hook add/remove (bead 71h.10) — dry-run/commit through
   *  POST /api/hooks/edit; the raw file never crosses the wire, so a redacted
   *  settings file is editable without the redaction-save trap. */
  editHooks: (req: HookEditRequest) => Promise<WriteResponse>;
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
  const [state, dispatch] = useReducer(appReducer, readStoredAgentKind(), initialAppState);

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

  // The picker is a shell-level control, so it must not disappear merely
  // because the selected folder has no local markers. Global entries are
  // already loaded independently of the current instance; successful entries
  // carry supported detector kinds and failed entries simply contribute none.
  const availableAgents = useMemo(
    () => collectAvailableAgents(state.report?.agents ?? [], state.globalReport?.entries ?? []),
    [state.report?.agents, state.globalReport?.entries],
  );

  // Single-flight guard for report fetches: each loadReport bumps this and drops
  // its result if a newer load has since started, so an out-of-order response
  // (e.g. a slow refetch of the same instance) can never render a stale report.
  // The reducer's instanceId check covers cross-instance switches; this covers
  // same-instance ordering. Mirrors the runId pattern in useWriteFlow.
  const loadGenRef = useRef(0);

  const loadReport = useCallback(
    async (instanceId: string | undefined) => {
      if (!client) return;
      const gen = ++loadGenRef.current;
      dispatch({ type: 'report:loading' });
      try {
        const report: Report = await client.getReport(instanceId);
        if (gen !== loadGenRef.current) return; // superseded by a newer load
        dispatch({ type: 'report:loaded', report, instanceId });
      } catch (err) {
        if (gen !== loadGenRef.current) return;
        dispatch({ type: 'error', error: toAppError(err) });
      }
    },
    [client],
  );

  const refetch = useCallback(() => {
    void loadReport(currentIdRef.current);
  }, [loadReport]);

  // Machine-global report (bead 71h.3): instance-independent and NON-BLOCKING —
  // a failure lands in the global slice only (never `error`, which the shell
  // reacts to), so the project view stays intact.
  const loadGlobal = useCallback(async () => {
    if (!client) return;
    dispatch({ type: 'global:loading' });
    try {
      const report: GlobalReport = await client.getGlobalReport();
      dispatch({ type: 'global:loaded', report });
    } catch (err) {
      dispatch({ type: 'global:error', error: toAppError(err) });
    }
  }, [client]);

  const refetchGlobal = useCallback(() => {
    void loadGlobal();
  }, [loadGlobal]);

  const selectInstance = useCallback(
    (id: string) => {
      currentIdRef.current = id;
      dispatch({ type: 'instance:select', id });
      void loadReport(id);
    },
    [loadReport],
  );

  const refreshInstances = useCallback(async () => {
    if (!client) return;
    try {
      dispatch({ type: 'instances:loaded', instances: await client.getInstances() });
    } catch {
      // Best-effort: a failed refresh leaves the prior list in place; the shell
      // surfaces fatal (network/unauthorized) states through its own chrome.
    }
  }, [client]);

  const selectAgent = useCallback((kind: string) => {
    dispatch({ type: 'agent:select', kind });
    writeStoredAgentKind(kind);
  }, []);

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

  const applyFix = useCallback(
    (findingId: string, opts: { dryRun: boolean }): Promise<ApplyFixResponse> => {
      if (!client) return Promise.reject(new ApiError(401, 'unauthorized', 'no session'));
      // Target the instance currently in view; undefined ⇒ server default.
      const instance = currentIdRef.current;
      return client.applyFix(findingId, { dryRun: opts.dryRun, ...(instance ? { instance } : {}) });
    },
    [client],
  );

  const writeFile = useCallback(
    (filePath: string, content: string, dryRun: boolean): Promise<WriteResponse> => {
      if (!client) return Promise.reject(new ApiError(401, 'unauthorized', 'no session'));
      return client.writeFile(filePath, content, dryRun);
    },
    [client],
  );

  const editHooks = useCallback(
    (req: HookEditRequest): Promise<WriteResponse> => {
      if (!client) return Promise.reject(new ApiError(401, 'unauthorized', 'no session'));
      return client.editHooks(req);
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

    // Fire the global fetch alongside the instances/report load — never awaited,
    // so a global failure cannot delay or degrade the project boot.
    void loadGlobal();

    void (async () => {
      try {
        const instances = await boot.client.getInstances();
        if (cancelled) return;
        dispatch({ type: 'instances:loaded', instances });
        const def = instances.find((i) => i.isDefault) ?? instances[0];
        // Put the resolved default INTO state (not just the ref): a render-time
        // `currentIdRef.current = state.currentInstanceId` would otherwise revert
        // the ref to undefined, leaving the WS push guard (which compares against
        // the ref) permanently mismatched for the boot instance. Dispatching
        // instance:select fixes both — it seeds currentInstanceId AND the ref
        // stays consistent across re-renders. No extra fetch: the loadReport
        // below is the only report request.
        if (def) {
          currentIdRef.current = def.id;
          dispatch({ type: 'instance:select', id: def.id });
        }
      } catch (err) {
        if (!cancelled) dispatch({ type: 'error', error: toAppError(err) });
      }
      if (cancelled) return;
      await loadReport(currentIdRef.current);
    })();

    const ws = boot.makeWs({
      onState: (s) => dispatch({ type: 'ws:state', state: s }),
      onMessage: (instance) => {
        // Refetch only when the push targets the instance we're viewing. The boot
        // path seeds currentIdRef (and currentInstanceId) with the default before
        // this can matter, so a push for the default instance matches and refetches
        // — the case that previously fell through the crack (bead).
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
  }, [resolvedDeps, loadReport, loadGlobal]);

  const value = useMemo<AppStateValue>(
    () => ({
      ...state,
      ...(client ? { client } : {}),
      currentInstance: selectCurrentInstance(state),
      availableAgents,
      agentScopeKind: state.report?.agents.some(
        (a) => a.kind === resolveActiveAgent(availableAgents, state.activeAgentKind)?.kind,
      )
        ? resolveActiveAgent(availableAgents, state.activeAgentKind)?.kind
        : undefined,
      activeAgent: resolveActiveAgent(availableAgents, state.activeAgentKind),
      selectInstance,
      refreshInstances,
      selectAgent,
      refetch,
      refetchGlobal,
      clearError,
      getFile,
      applyFix,
      writeFile,
      editHooks,
    }),
    [
      state,
      client,
      availableAgents,
      selectInstance,
      refreshInstances,
      selectAgent,
      refetch,
      refetchGlobal,
      clearError,
      getFile,
      applyFix,
      writeFile,
      editHooks,
    ],
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

/**
 * Global-scope convenience selector (bead 71h.3) for pages that render the
 * inherited (~/.claude etc.) config. `entries` are the successful per-dir scans;
 * per-dir failures are separated into `errors` so pages render honest partial
 * states. Global config is READ-ONLY from the project view — file content still
 * comes through the existing getFile(absolutePath).
 */
export function useGlobalConfig(): {
  globalReport?: GlobalReport;
  globalLoading: boolean;
  globalError?: AppError;
  refetchGlobal: () => void;
  entries: GlobalEntry[];
  errors: GlobalEntryError[];
} {
  const { globalReport, globalLoading, globalError, refetchGlobal } = useAppState();
  const { entries, errors } = useMemo(() => {
    const entries: GlobalEntry[] = [];
    const errors: GlobalEntryError[] = [];
    for (const entry of globalReport?.entries ?? []) {
      if (isGlobalEntryError(entry)) errors.push(entry);
      else entries.push(entry);
    }
    return { entries, errors };
  }, [globalReport]);
  return { globalReport, globalLoading, globalError, refetchGlobal, entries, errors };
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
