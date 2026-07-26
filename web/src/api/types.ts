/**
 * Wire types for the local control-center API. These MIRROR the server's
 * serialized shapes — the web app is deliberately self-contained and does NOT
 * import from src/ (the server build). Keep these in sync with the source of
 * truth:
 *   - report / finding / agent shapes: src/core/report.ts + src/core/findings.ts
 *     + src/core/detectors/types.ts + src/core/manifest.ts
 *   - served report / file: src/server/store.ts + src/server/write.ts
 *   - instance summary: src/server/registry.ts
 *   - WS push messages: src/server/watcher.ts (WatcherMessage)
 *
 * Everything here is CONTENT-FREE by contract: findings carry `hasFix`/`fixKind`
 * (never the fix patch body), agents carry paths/kinds only. File CONTENT arrives
 * solely via GET /api/file and MUST be rendered as text nodes (never HTML).
 */

/** Finding severity (src/core/findings.ts). */
export type Severity = 'error' | 'warning' | 'info';

/** Detector confidence rating (src/core/detectors/types.ts). */
export type Confidence = 'low' | 'medium' | 'high';

/** Machine-fix kind — the only fix detail ever serialized (src/core/findings.ts). */
export type FixKind = 'create-file' | 'replace-file';

/**
 * A finding as SERVED by the API: the full finding minus the secret-bearing
 * `fix` payload, which is summarized as `hasFix`/`fixKind` (src/core/report.ts,
 * `ReportFinding`). There is no patch body here by design.
 */
export interface ReportFinding {
  id: string;
  severity: Severity;
  agent: string;
  title: string;
  detail: string;
  suggestion?: string;
  hasFix?: true;
  fixKind?: FixKind;
}

/** A detected agent runtime (src/core/detectors/types.ts, `DetectedAgent`). */
export interface DetectedAgent {
  /** Stable runtime id, e.g. 'claude-code'. */
  kind: string;
  confidence: Confidence;
  /** Manifest file paths that contributed to detection. */
  files: string[];
  /** Open metadata bag of per-runtime details. */
  extras: Record<string, unknown>;
}

/** Manifest scan statistics (src/core/manifest.ts, `ManifestStats`). */
export interface ManifestStats {
  fileCount: number;
  totalBytes: number;
  skipped?: number;
}

/** GET /api/report payload (src/server/store.ts, `ServedReport`). */
export interface Report {
  version: string;
  generatedAt: string;
  root: string;
  scope: 'project' | 'global';
  localOnly: boolean;
  agents: DetectedAgent[];
  findings: ReportFinding[];
  stats: ManifestStats;
}

/** One entry in GET /api/instances (src/server/registry.ts, `InstanceSummary`). */
export interface InstanceSummary {
  id: string;
  /** Display name — basename of the root. */
  name: string;
  root: string;
  markers: string[];
  loaded: boolean;
  isDefault: boolean;
}

/** GET /api/instances payload. */
export interface InstancesResponse {
  instances: InstanceSummary[];
}

/**
 * One discovery hit from POST /api/instances/scan (src/core/discovery/
 * discovery.ts, `DiscoveryHit`). `root` is user/filesystem data — render as a
 * text node only, never HTML.
 */
export interface ScanHit {
  /** Absolute path of the directory that carries markers. */
  root: string;
  /** Marker entry names found at this root (e.g. 'CLAUDE.md'), codepoint-sorted. */
  markers: string[];
  /** Runtime ids the markers attribute to (detector ids), codepoint-sorted. */
  runtimes: string[];
}

/** Scan walk statistics (src/core/discovery/discovery.ts, `DiscoveryStats`). */
export interface ScanStats {
  dirsVisited: number;
  truncated: boolean;
  skipped: number;
}

/**
 * POST /api/instances/scan payload — OFFERS discovery hits; it never auto-adds
 * (adding still goes through POST /api/instances). See src/server/app.ts.
 */
export interface ScanResponse {
  hits: ScanHit[];
  stats: ScanStats;
}

/** POST /api/instances/:id/unload payload. */
export interface UnloadResponse {
  id: string;
  loaded: boolean;
}

/** DELETE /api/instances/:id payload. */
export interface RemoveResponse {
  id: string;
  removed: boolean;
}

/** GET /api/health payload. */
export interface HealthResponse {
  ok: boolean;
  version: string;
}

/**
 * POST /api/write payload (src/server/write.ts). `dryRun:true` returns the
 * preview (no disk touch); `dryRun:false` reports the commit. `diff` is unified
 * diff TEXT — parse it (write/parseDiff) and render only as text nodes.
 */
export interface WriteResponse {
  /** Present on a commit; absent on a dry-run. */
  committed?: true;
  created?: boolean;
  modified?: boolean;
  willCreate?: boolean;
  willModify?: boolean;
  path?: string;
  pathScope: string;
  diff: string;
}

/**
 * One edit row in an apply-fix response (src/server/write.ts). `diff` is the
 * INTENDED disclosure of the fix's patch content — the preview the user approves
 * — carried as unified diff TEXT. `committed`/`error` are present only on a
 * commit response.
 */
export interface FixEdit {
  path: string;
  pathScope: string;
  willCreate: boolean;
  willModify: boolean;
  diff: string;
  committed?: boolean;
  error?: string;
}

/** POST /api/apply-fix payload (dry-run OR commit; src/server/write.ts). */
export interface ApplyFixResponse {
  /** True on a dry-run response; absent on a commit response. */
  dryRun?: true;
  /** True when every edit committed; present only on a commit response. */
  committed?: boolean;
  findingId: string;
  fixKind?: FixKind;
  edits: FixEdit[];
}

/**
 * One `[REDACTED:*]` mark's offsets over a served file's `content`
 * (src/core/redact.ts `RedactionSpan`). `[start, end)` index into the REDACTED
 * text; `id` names the catalogue pattern that fired (e.g. 'openai', 'github').
 */
export interface RedactionSpan {
  start: number;
  end: number;
  id: string;
}

/**
 * GET /api/file payload (src/server/write.ts). `content` is the REDACTED text —
 * secrets are replaced server-side by visible `[REDACTED:*]` marks BEFORE the
 * response is serialized, so a raw secret never crosses the wire (SPEC §3).
 * `spans` locates each mark within `content` for styling. Render as text only.
 */
export interface FileContent {
  path: string;
  content: string;
  spans: RedactionSpan[];
  pathScope: string;
}

/**
 * Server→client WebSocket push messages (src/server/watcher.ts,
 * `WatcherMessage`). A `report` push means the instance's config changed on disk
 * → the UI should refetch; `live-session` is a growing-session pulse.
 */
export type WsMessage =
  | { type: 'report'; instance: string; changed: string[] }
  | { type: 'live-session'; instance: string; sessionId: string };
