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
  ContextHealth,
  CatalogRemoveResponse,
  CatalogResponse,
  FileContent,
  GitBranchesResponse,
  GitDiffResponse,
  GitLogResponse,
  GitMutationResponse,
  GitStatusResponse,
  GlobalReport,
  HealthResponse,
  HookEditRequest,
  Pipeline,
  PipelineListResponse,
  PipelineResponse,
  SavePipelineResponse,
  DeletePipelineResponse,
  RunStartResponse,
  RunSnapshot,
  RunHistoryEntry,
  RunHistoryResponse,
  ScheduleResponse,
  InstalledPluginsResponse,
  InstallPluginResponse,
  InstanceSummary,
  InstancesResponse,
  KnownProjectsResponse,
  MarketplaceResponse,
  PtyStatusResponse,
  RemoveResponse,
  Report,
  ScanResponse,
  SearchMode,
  SearchReindexResponse,
  SearchResponse,
  SearchStatusResponse,
  SessionDetail,
  SessionsResponse,
  SessionTagsResponse,
  StatsResponse,
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

/** `?instance=<id>` query suffix, or '' when the default instance is intended. */
function qsInstance(instance?: string): string {
  return instance ? `?instance=${encodeURIComponent(instance)}` : '';
}

/** Merge an optional instance id into a git POST body (omitted when absent). */
function gitBody(fields: Record<string, unknown>, instance?: string): Record<string, unknown> {
  return instance !== undefined ? { ...fields, instance } : fields;
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
    // Browser global fetch is this-sensitive ("Illegal invocation" if called
    // with a foreign `this`), so the default must be bound to globalThis.
    this.#fetch = opts.fetchImpl ?? fetch.bind(globalThis);
  }

  /** GET the report for an instance (or the default instance when omitted). */
  getReport(instance?: string): Promise<Report> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<Report>(`/api/report${qs}`);
  }

  /**
   * GET the machine-global (inherited) config report (bead 71h.3) — one entry
   * per well-known home config dir (~/.claude, …). The global scope is
   * instance-independent (never an `instance` selector); `fresh` forces a
   * server-side rescan instead of the cached report.
   */
  getGlobalReport(opts: { fresh?: boolean } = {}): Promise<GlobalReport> {
    const qs = opts.fresh ? '?scope=global&fresh=1' : '?scope=global';
    return this.#get<GlobalReport>(`/api/report${qs}`);
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
   * KNOWN-PROJECT SUGGESTIONS (bead qoc.3) — project roots seen in THIS machine's
   * ~/.claude history (server-derived, cwd read from session entries not the lossy
   * slug) that EXIST on disk and are NOT already registered. Each is one-click
   * added through the EXISTING {@link addInstance} flow. Roots are filesystem text.
   */
  getKnownProjects(): Promise<KnownProjectsResponse> {
    return this.#get<KnownProjectsResponse>('/api/known-projects');
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
   * STRUCTURED HOOK EDIT (bead 71h.10; server bead 71h.9) — add or remove one
   * hook in a settings.json through POST /api/hooks/edit. Unlike
   * {@link writeFile}, no file content crosses the wire: the server re-reads
   * the RAW file and applies the surgical op, so a REDACTED settings file
   * (secrets in `env`) stays editable without the redaction-save trap.
   * `dryRun:true` returns the PRE-REDACTED diff preview; `dryRun:false`
   * commits. A stale remove address/command is a 409 (`kind:'conflict'`); an
   * absent file is a 404 (callers fall back to a whole-file create).
   */
  editHooks(req: HookEditRequest): Promise<WriteResponse> {
    return this.#send<WriteResponse>('/api/hooks/edit', 'POST', req);
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

  /**
   * CONTEXT HEALTH (bead 7yb.6) — the content-free size/footprint view of the
   * agent config that loads into an agent's context window (total vs a budget,
   * largest contributors, size-derived suggestions). Computed server-side over
   * the same scanned manifest as the report; carries sizes + paths only.
   */
  getContextHealth(instance?: string): Promise<ContextHealth> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<ContextHealth>(`/api/context-health${qs}`);
  }

  /** GET the embedded-terminal capability probe (ngs.2) for an instance. */
  getPtyStatus(instance?: string): Promise<PtyStatusResponse> {
    const qs = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return this.#get<PtyStatusResponse>(`/api/pty/status${qs}`);
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

  /**
   * DASHBOARD STATS (bead 7yb.2) — the read-only session-analytics surface. The
   * shell keeps its ApiClient private, so the Dashboard page builds its own client
   * from the launch token (the Marketplace/Settings pattern). `getStats` is the
   * aggregate `DashboardStats` + achievement metadata (server-derived from THIS
   * machine's `~/.claude` history, bounded to the most-recent N sessions — never
   * message content). `getSessions` is a bounded, content-free session list.
   */
  getStats(): Promise<StatsResponse> {
    return this.#get<StatsResponse>('/api/stats');
  }

  getSessions(): Promise<SessionsResponse> {
    return this.#get<SessionsResponse>('/api/sessions');
  }

  /**
   * SESSION REPLAY (bead 7yb.3) — ONE session's messages, PAGINATED. The server
   * validates `id` against its discovered set (an unknown/`../../` id is a 404,
   * never a file read) and REDACTS every secret-bearing string before it crosses
   * the wire, so `content` is always safe to render as text. `offset`/`limit`
   * window a large session (limit is clamped server-side).
   */
  getSessionDetail(
    id: string,
    opts: { offset?: number; limit?: number } = {},
  ): Promise<SessionDetail> {
    const qs = new URLSearchParams();
    if (opts.offset !== undefined) qs.set('offset', String(opts.offset));
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
    return this.#get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}${suffix}`);
  }

  /**
   * SESSION SEARCH (bead 7yb.4) — full-text search over session turns + tool
   * results (SQLite FTS5). The index is backed by the OPTIONAL better-sqlite3
   * native module; when it can't load the response is `{ available:false, reason }`
   * (a 200, not an error) so the page shows a clear unavailable state. Result
   * snippets are REDACTED server-side — render them as text nodes only. `mode`
   * defaults to `fts`; `semantic` is the opt-in embeddings mode (a v1 stub).
   */
  searchSessions(
    query: string,
    opts: { mode?: SearchMode; limit?: number } = {},
  ): Promise<SearchResponse> {
    const qs = new URLSearchParams({ q: query });
    if (opts.mode !== undefined) qs.set('mode', opts.mode);
    if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
    return this.#get<SearchResponse>(`/api/search?${qs.toString()}`);
  }

  /** Rebuild the FTS index (incremental by mtime) → coverage stats. */
  reindexSearch(): Promise<SearchReindexResponse> {
    return this.#send<SearchReindexResponse>('/api/search/reindex', 'POST');
  }

  /** Index availability + coverage vs. total + the embeddings flag. */
  getSearchStatus(): Promise<SearchStatusResponse> {
    return this.#get<SearchStatusResponse>('/api/search/status');
  }

  /**
   * GIT PANEL (bead ngs.1) — the launched-repo git surface. The server shells out
   * to `git` (execFile, no shell, cwd pinned to the instance repo root) and
   * validates every ref/path; the commit message is piped on stdin. When git is
   * ABSENT the response is `{ gitAvailable:false }` and a non-repo dir is
   * `{ isRepo:false }` (both 200s, not errors) so the page shows a clear empty
   * state. Every git field is UNTRUSTED subprocess output — render as text nodes.
   */
  getGitStatus(instance?: string): Promise<GitStatusResponse> {
    return this.#get<GitStatusResponse>(`/api/git/status${qsInstance(instance)}`);
  }

  getGitLog(instance?: string): Promise<GitLogResponse> {
    return this.#get<GitLogResponse>(`/api/git/log${qsInstance(instance)}`);
  }

  getGitBranches(instance?: string): Promise<GitBranchesResponse> {
    return this.#get<GitBranchesResponse>(`/api/git/branches${qsInstance(instance)}`);
  }

  getGitDiff(pathArg: string, staged: boolean, instance?: string): Promise<GitDiffResponse> {
    const qs = new URLSearchParams({ path: pathArg });
    if (staged) qs.set('staged', '1');
    if (instance !== undefined) qs.set('instance', instance);
    return this.#get<GitDiffResponse>(`/api/git/diff?${qs.toString()}`);
  }

  gitStage(files: string[], instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>('/api/git/stage', 'POST', gitBody({ files }, instance));
  }

  gitUnstage(files: string[], instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>(
      '/api/git/unstage',
      'POST',
      gitBody({ files }, instance),
    );
  }

  gitCommit(message: string, instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>(
      '/api/git/commit',
      'POST',
      gitBody({ message }, instance),
    );
  }

  gitCheckout(branch: string, create: boolean, instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>(
      '/api/git/checkout',
      'POST',
      gitBody({ branch, create }, instance),
    );
  }

  gitPush(instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>('/api/git/push', 'POST', gitBody({}, instance));
  }

  gitPull(instance?: string): Promise<GitMutationResponse> {
    return this.#send<GitMutationResponse>('/api/git/pull', 'POST', gitBody({}, instance));
  }

  /**
   * PIPELINES (bead ira.2) — the visual-workflow persistence + run surface. Like
   * Git/Marketplace, the shell keeps its ApiClient private, so the Pipelines page
   * builds its own from the launch token. A pipeline is UNTRUSTED user config
   * (bash scripts / urls / paths) — render every field as a text node.
   *
   * `savePipeline` validates SERVER-side (validatePipeline); an invalid graph is a
   * 400 whose `message` is the joined validation errors. `runPipeline` starts a
   * run (executing the guarded server executor — running bash is CSRF-gated) and
   * returns a `runId`; poll {@link getRun} for LIVE per-node status.
   */
  async listPipelines(): Promise<PipelineListResponse['pipelines']> {
    const body = await this.#get<PipelineListResponse>('/api/pipelines');
    return body.pipelines;
  }

  async getPipeline(id: string): Promise<Pipeline> {
    const body = await this.#get<PipelineResponse>(`/api/pipelines/${encodeURIComponent(id)}`);
    return body.pipeline;
  }

  savePipeline(pipeline: Pipeline): Promise<SavePipelineResponse> {
    return this.#send<SavePipelineResponse>('/api/pipelines', 'POST', pipeline);
  }

  deletePipeline(id: string): Promise<DeletePipelineResponse> {
    return this.#send<DeletePipelineResponse>(`/api/pipelines/${encodeURIComponent(id)}`, 'DELETE');
  }

  runPipeline(id: string, input: unknown, instance?: string): Promise<RunStartResponse> {
    return this.#send<RunStartResponse>(
      `/api/pipelines/${encodeURIComponent(id)}/run${qsInstance(instance)}`,
      'POST',
      { input },
    );
  }

  getRun(runId: string): Promise<RunSnapshot> {
    return this.#get<RunSnapshot>(`/api/pipelines/runs/${encodeURIComponent(runId)}`);
  }

  /**
   * RUN HISTORY (bead ira.3) — the most-recent runs for one pipeline as METADATA
   * (status, timing, per-node status counts; never output). Select a row and
   * fetch its REPLAY detail with {@link getRun} (output redacted server-side).
   */
  async listRuns(id: string): Promise<RunHistoryEntry[]> {
    const body = await this.#get<RunHistoryResponse>(
      `/api/pipelines/${encodeURIComponent(id)}/runs`,
    );
    return body.runs;
  }

  /**
   * SCHEDULE (bead ira.4) — read/write a pipeline's cron/preset schedule. The
   * schedule only RUNS when a daemon (`agentconfiging daemon`) is up; the
   * interactive server persists it and reports the next fire time. `setSchedule`
   * validates the cron SERVER-side (an invalid cron is a 400) and binds the run
   * to the current instance's root.
   */
  getSchedule(id: string): Promise<ScheduleResponse> {
    return this.#get<ScheduleResponse>(`/api/pipelines/${encodeURIComponent(id)}/schedule`);
  }

  setSchedule(
    id: string,
    cron: string,
    enabled: boolean,
    instance?: string,
  ): Promise<ScheduleResponse> {
    return this.#send<ScheduleResponse>(
      `/api/pipelines/${encodeURIComponent(id)}/schedule${qsInstance(instance)}`,
      'POST',
      { cron, enabled },
    );
  }

  /** Replace the local tag set for one session (stored in a local sidecar). */
  setSessionTags(id: string, tags: string[]): Promise<SessionTagsResponse> {
    return this.#send<SessionTagsResponse>(`/api/sessions/${encodeURIComponent(id)}/tags`, 'POST', {
      tags,
    });
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
