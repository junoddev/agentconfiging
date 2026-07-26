/**
 * Typed API client for the local control center. Every request carries the
 * session token as `Authorization: Bearer <token>` (SPEC §4.3) — the only
 * accepted channel (no `?token=` fallback). Responses are typed against the
 * mirrored wire shapes in ./types.
 *
 * ERROR MODEL: failures surface as `ApiError` with a coarse `kind` so the shell
 * can render an honest state instead of crashing. A 401 (missing/stale token) is
 * `kind: 'unauthorized'` — the shell shows a re-launch prompt rather than a
 * blank page.
 */

import type {
  ApplyFixResponse,
  CatalogInstallResponse,
  CatalogRemoveResponse,
  CatalogResponse,
  FileContent,
  HealthResponse,
  InstalledPluginsResponse,
  InstallPluginResponse,
  InstanceSummary,
  InstancesResponse,
  MarketplaceResponse,
  RemoveResponse,
  Report,
  ScanResponse,
  StorageCleanupResponse,
  StorageReport,
  SyncResponse,
  UnloadResponse,
  WriteResponse,
} from './types.js';

export type ApiErrorKind =
  | 'unauthorized' // 401 — token missing or wrong
  | 'forbidden' // 403 — Host/Origin gate / out-of-scope write
  | 'notfound' // 404 — unknown instance / absent file
  | 'badrequest' // 400 — validation (e.g. add/scan path is not a directory)
  | 'conflict' // 409 — a fix precondition no longer holds (apply-fix)
  | 'network' // fetch itself threw (server down, offline)
  | 'server' // 5xx
  | 'unknown';

/** A typed API failure. `status` is 0 when the network layer threw. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 400) return 'badrequest';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * Pull the server's terse `{ error }` message from a failed response so callers
 * (e.g. the instance-add flow) can surface it inline. Falls back to `HTTP <n>`
 * when the body is absent or not the expected shape.
 */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body !== null && typeof body === 'object') {
      const { error } = body as { error?: unknown };
      if (typeof error === 'string' && error !== '') return error;
    }
  } catch {
    // body was not JSON — fall through to the coarse status message.
  }
  return `HTTP ${res.status}`;
}

export interface ApiClientOptions {
  /** Base URL prefix; '' (default) targets the same origin the shell loaded from. */
  baseUrl?: string;
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(token: string, opts: ApiClientOptions = {}) {
    this.#token = token;
    this.#baseUrl = opts.baseUrl ?? '';
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  /** GET the report for an instance (or the default instance when omitted). */
  getReport(instance?: string): Promise<Report> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<Report>(`/api/report${qs}`);
  }

  /** GET the hosted instance list. */
  async getInstances(): Promise<InstancesResponse['instances']> {
    const body = await this.#get<InstancesResponse>('/api/instances');
    return body.instances;
  }

  /** GET a health probe (also token-gated). */
  getHealth(): Promise<HealthResponse> {
    return this.#get<HealthResponse>('/api/health');
  }

  /** GET a single in-scope config file's REDACTED content + mark spans (secrets
   *  are stripped server-side; render as text only). */
  getFile(path: string): Promise<FileContent> {
    return this.#get<FileContent>(`/api/file?path=${encodeURIComponent(path)}`);
  }

  /**
   * ADD FLOW — the one place a new root enters the workspace. The server
   * realpath-guards + requires an existing directory; a bad path is a 400
   * (`kind: 'badrequest'`) whose `message` is the server's terse reason. Added
   * lazily — no scan until the instance is first opened.
   */
  addInstance(path: string): Promise<InstanceSummary> {
    return this.#send<InstanceSummary>('/api/instances', 'POST', { path });
  }

  /**
   * RECURSIVE SCAN — depth/dir-bounded discovery under `path`. Returns hits to
   * OFFER (each add still goes through {@link addInstance}); it never auto-adds.
   * A bad scan root is a 400.
   */
  scanFolder(path: string): Promise<ScanResponse> {
    return this.#send<ScanResponse>('/api/instances/scan', 'POST', { path });
  }

  /**
   * WRITE FLOW (bead wmc.1) — write one config file through the guarded server
   * path. `dryRun:true` returns the diff preview (no disk touch); `dryRun:false`
   * commits. The proposed `content` is the COMPLETE replacement file body. This
   * is the primitive editors (wmc.2-10) save through; the Findings APPLY flow
   * uses {@link applyFix} instead (its patch is server-side, never sent here).
   */
  writeFile(path: string, content: string, dryRun: boolean): Promise<WriteResponse> {
    return this.#send<WriteResponse>('/api/write', 'POST', { path, content, dryRun });
  }

  /**
   * APPLY-FIX (bead wmc.1) — dry-run or commit a finding's machine fix. The
   * client never holds the fix patch (stripped server-side); it names the
   * finding and the server recomputes + guards every edit. `dryRun:true` returns
   * the unified diff to preview; `dryRun:false` applies it. `instance` defaults
   * to the server's default instance when omitted.
   */
  applyFix(
    findingId: string,
    opts: { dryRun: boolean; instance?: string },
  ): Promise<ApplyFixResponse> {
    const body: Record<string, unknown> = { findingId, dryRun: opts.dryRun };
    if (opts.instance !== undefined) body['instance'] = opts.instance;
    return this.#send<ApplyFixResponse>('/api/apply-fix', 'POST', body);
  }

  /** Free a loaded instance's engine store (●→○); the next report re-scans it. */
  unloadInstance(id: string): Promise<UnloadResponse> {
    return this.#send<UnloadResponse>(`/api/instances/${encodeURIComponent(id)}/unload`, 'POST');
  }

  /** Drop an instance from the workspace entirely (mildly destructive). */
  removeInstance(id: string): Promise<RemoveResponse> {
    return this.#send<RemoveResponse>(`/api/instances/${encodeURIComponent(id)}`, 'DELETE');
  }

  /**
   * STORAGE (bead wmc.2) — the settings editor is the one page that needs these;
   * the shell keeps its client private, so the page builds its own ApiClient from
   * the launch token (the Instances-page pattern). `getStorage` is a disk-usage
   * breakdown per instance; `cleanupStorage` TRASHES one allowlisted, safe-to-
   * clean subdir (server-validated by `home` KEY + `name`, never a raw path).
   */
  getStorage(instance?: string): Promise<StorageReport> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<StorageReport>(`/api/storage${qs}`);
  }

  cleanupStorage(home: string, name: string, instance?: string): Promise<StorageCleanupResponse> {
    const body: Record<string, unknown> = { home, name };
    if (instance !== undefined) body['instance'] = instance;
    return this.#send<StorageCleanupResponse>('/api/storage/cleanup', 'POST', body);
  }

  /**
   * INSTRUCTION SYNC (bead wmc.10) — regenerate other runtimes' instruction
   * files from a designated source of truth. `dryRun:true` returns per-target
   * unified diffs + sync status (no disk touch); `dryRun:false` writes each
   * writable, non-in-sync target through the guarded server write path. Omitting
   * `targets` plans EVERY sync target (first-class + long-tail); passing ids
   * narrows it. `instance` defaults to the server's default instance.
   */
  syncInstructions(
    sourcePath: string,
    opts: { dryRun: boolean; targets?: string[]; instance?: string },
  ): Promise<SyncResponse> {
    const body: Record<string, unknown> = { sourcePath, dryRun: opts.dryRun };
    if (opts.targets !== undefined) body['targets'] = opts.targets;
    if (opts.instance !== undefined) body['instance'] = opts.instance;
    return this.#send<SyncResponse>('/api/sync', 'POST', body);
  }

  /**
   * CATALOG (bead 0zm.4) — the registry install/remove flow. `getCatalog` lists
   * entry METADATA (never file bodies) plus the resolved instance's installed
   * records. `installEntry`/`removeEntry` mirror the write flow: `dryRun:true`
   * returns the per-file diff / trash preview (no disk touch); `dryRun:false`
   * commits through the guarded server path. `instance` defaults to the server's
   * default instance. Registry content is untrusted — render every field as text.
   */
  getCatalog(instance?: string): Promise<CatalogResponse> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<CatalogResponse>(`/api/catalog${qs}`);
  }

  installEntry(
    entryKey: string,
    opts: { dryRun: boolean; instance?: string },
  ): Promise<CatalogInstallResponse> {
    const body: Record<string, unknown> = { entryKey, dryRun: opts.dryRun };
    if (opts.instance !== undefined) body['instance'] = opts.instance;
    return this.#send<CatalogInstallResponse>('/api/catalog/install', 'POST', body);
  }

  removeEntry(
    entryKey: string,
    opts: { dryRun: boolean; instance?: string },
  ): Promise<CatalogRemoveResponse> {
    const body: Record<string, unknown> = { entryKey, dryRun: opts.dryRun };
    if (opts.instance !== undefined) body['instance'] = opts.instance;
    return this.#send<CatalogRemoveResponse>('/api/catalog/remove', 'POST', body);
  }

  /**
   * MARKETPLACE (bead 0zm.5) — the Claude Code plugin marketplace. The server
   * shells out to the `claude` CLI; when that CLI is ABSENT the response is
   * `{ available:false, reason }` (a 200, not an error) so the page shows a clear
   * empty state. Every plugin field is UNTRUSTED subprocess output — render as
   * text nodes only.
   */
  getMarketplace(): Promise<MarketplaceResponse> {
    return this.#get<MarketplaceResponse>('/api/marketplace');
  }

  /** The installed Claude Code plugins (version/scope/date). */
  getInstalledPlugins(): Promise<InstalledPluginsResponse> {
    return this.#get<InstalledPluginsResponse>('/api/marketplace/installed');
  }

  /**
   * One-click install. `name` is validated SERVER-side against the marketplace
   * listing (allowlist) and a strict charset before it is ever passed to the
   * `claude` CLI as a positional arg — never interpolated into a shell.
   */
  installPlugin(name: string): Promise<InstallPluginResponse> {
    return this.#send<InstallPluginResponse>('/api/marketplace/install', 'POST', { name });
  }

  async #get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.#token}` },
      });
    } catch (err) {
      throw new ApiError(0, 'network', `request failed: ${String(err)}`);
    }
    if (!res.ok) {
      throw new ApiError(res.status, kindForStatus(res.status), `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Bearer-authed mutation (POST/DELETE) with an optional JSON body. Surfaces
   *  the server's terse `{ error }` reason on failure (see {@link errorMessage}). */
  async #send<T>(path: string, method: 'POST' | 'DELETE', body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch (err) {
      throw new ApiError(0, 'network', `request failed: ${String(err)}`);
    }
    if (!res.ok) {
      throw new ApiError(res.status, kindForStatus(res.status), await errorMessage(res));
    }
    return (await res.json()) as T;
  }
}
