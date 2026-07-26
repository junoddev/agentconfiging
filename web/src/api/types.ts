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

/** GET /api/health payload. */
export interface HealthResponse {
  ok: boolean;
  version: string;
}

/** GET /api/file payload (src/server/write.ts). `content` is RAW — text only. */
export interface FileContent {
  path: string;
  content: string;
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
