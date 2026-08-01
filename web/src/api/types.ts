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

/**
 * MACHINE-GLOBAL REPORT (bead 71h.3, GET /api/report?scope=global). These MIRROR
 * src/core/global.ts + src/server/store.ts (`ServedGlobalReport`). One entry per
 * well-known home config dir (~/.claude, ~/.cursor, …); a per-dir scan failure is
 * an inline `GlobalEntryError` so siblings survive. Content-free like the project
 * report; global file CONTENT still arrives solely via GET /api/file. `root` is
 * filesystem data — render as a text node only.
 */

/** One successfully scanned global config dir (src/core/global.ts, `GlobalEntry`). */
export interface GlobalEntry {
  /** Real path of the config dir (symlinks resolved by the scanner). */
  root: string;
  /** Well-known dir name under home (e.g. '.claude'). */
  dir: string;
  agents: DetectedAgent[];
  findings: ReportFinding[];
  stats: ManifestStats;
}

/** A global config dir whose scan failed (caps tripped); siblings survive. */
export interface GlobalEntryError {
  /** Logical path under home (join, not realpath — the dir may be unreadable). */
  root: string;
  /** Well-known dir name under home (e.g. '.cursor'). */
  dir: string;
  error: { name: string; code?: string; message: string };
}

/** Narrow a global entry to the error variant. */
export function isGlobalEntryError(e: GlobalEntry | GlobalEntryError): e is GlobalEntryError {
  return 'error' in e;
}

/** GET /api/report?scope=global payload (src/server/store.ts, `ServedGlobalReport`). */
export interface GlobalReport {
  version: string;
  generatedAt: string;
  scope: 'global';
  /** Always true: global config is THIS machine's home dirs, never remote. */
  localOnly: true;
  entries: (GlobalEntry | GlobalEntryError)[];
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
 * KNOWN-PROJECT SUGGESTION (bead qoc.3, GET /api/known-projects). MIRRORS
 * src/server/known-projects.ts. A project root seen in THIS machine's ~/.claude
 * history (cwd read from the session ENTRIES, never the lossy slug) that EXISTS
 * on disk and is NOT already a registered instance — offered to the add flow.
 * `root` is filesystem data; render it as a text node only.
 */
export interface KnownProject {
  root: string;
  /** ISO timestamp of the most-recent session touching this root, when known. */
  lastSeen?: string;
  /** Sessions (within the scanned window) whose cwd resolved to this root. */
  sessionCount: number;
}

/** GET /api/known-projects payload — suggested roots for the add flow. */
export interface KnownProjectsResponse {
  projects: KnownProject[];
  sessionsTotal: number;
  capped: boolean;
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
 * POST /api/hooks/edit payload (src/server/hooks-edit.ts, beads 71h.9/71h.10) —
 * the STRUCTURED hook mutation. Unlike /api/write, no file content crosses the
 * wire: the server re-reads the RAW settings file and applies the op, so a
 * REDACTED file stays editable without the redaction-save trap. `path` names
 * the settings file (project-relative or absolute global); `remove` addresses
 * the hook by the client's own parseHooksBlock coordinates and pins
 * `expected.command` as a precondition (stale ⇒ 409). `dryRun` defaults to
 * TRUE server-side. The response mirrors {@link WriteResponse}; its `diff` is
 * PRE-REDACTED before serialization.
 */
export type HookEditRequest = { path: string; dryRun?: boolean } & (
  | { op: 'add'; event: string; matcher?: string; hook: { type: 'command'; command: string } }
  | {
      op: 'remove';
      address: { event: string; groupIndex: number; hookIndex: number };
      expected: { command: string };
    }
);

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
 * One subdirectory row in a storage home (src/server/storage.ts). `bytes`/`files`
 * are a recursive total; `safeToClean` marks an ephemeral runtime-state dir the
 * cleanup allowlist permits trashing. `name` is filesystem data — text only.
 */
export interface StorageEntry {
  name: string;
  bytes: number;
  files: number;
  safeToClean: boolean;
}

/**
 * One agent-config home in a storage breakdown (src/server/storage.ts). `key` is
 * the server-issued handle cleanup takes (e.g. 'global:.claude'); `root` is the
 * absolute path (text only). Never pass a raw path to cleanup — pass `key`.
 */
export interface StorageHome {
  key: string;
  scope: 'project' | 'global';
  root: string;
  totalBytes: number;
  entries: StorageEntry[];
}

/** GET /api/storage payload (src/server/storage.ts). */
export interface StorageReport {
  instance: string;
  homes: StorageHome[];
}

/**
 * CONTEXT HEALTH (bead 7yb.6, GET /api/context-health). MIRRORS the core
 * `ContextHealth` (src/core/context-health/types.ts). Content-free by contract:
 * sizes + config paths + honest, size-derived suggestion text — never a file
 * body. Paths are filesystem data; render as text nodes only.
 */

/** Which context-loaded config category a file belongs to. */
export type ContextCategory =
  'instructions' | 'settings' | 'rules' | 'memory' | 'skills' | 'subagents' | 'commands' | 'mcp';

/** One context-loaded config file: path + byte size + category. */
export interface ContextFile {
  path: string;
  size: number;
  category: ContextCategory;
}

/** Aggregate byte/file total for one category. */
export interface CategoryTotal {
  category: ContextCategory;
  bytes: number;
  files: number;
}

/** Budget verdict: within, nearing, or over the ceiling. */
export type BudgetStatus = 'ok' | 'warn' | 'over';

/** One optimization suggestion. `message` is derived purely from sizes. */
export interface ContextSuggestion {
  id: string;
  severity: 'warn' | 'info';
  message: string;
}

/** GET /api/context-health payload (src/core/context-health, `ContextHealth`). */
export interface ContextHealth {
  totalBytes: number;
  fileCount: number;
  budgetBytes: number;
  budgetRatio: number;
  status: BudgetStatus;
  byCategory: CategoryTotal[];
  largest: ContextFile[];
  suggestions: ContextSuggestion[];
}

/**
 * CONTEXT COST (agentconfig-ub3.5, GET /api/context-cost). Mirrors the expected
 * ub3.2 server contract: one launch-time initial-context token breakdown per
 * detected agent. Token counts are estimates from the canonical core pass; the
 * web app only renders numbers, categories, and paths.
 */

/** One token-estimated file in an agent's initial context. */
export interface ContextCostFile {
  path: string;
  tokens: number;
  category: ContextCategory;
}

/** Token total for one context category inside a detected agent. */
export interface ContextCostCategory {
  category: ContextCategory;
  tokens: number;
  files: number;
}

/** Per-agent initial context token budget breakdown. */
export interface AgentContextCost {
  kind: string;
  totalTokens: number;
  budgetTokens: number;
  budgetRatio: number;
  status: BudgetStatus;
  byCategory?: ContextCostCategory[];
  files?: ContextCostFile[];
}

/** GET /api/context-cost payload. */
export interface ContextCost {
  budgetTokens: number;
  agents: AgentContextCost[];
}

/** POST /api/storage/cleanup payload (src/server/storage.ts). */
export interface StorageCleanupResponse {
  cleaned: true;
  home: string;
  name: string;
  bytes: number;
  files: number;
  trashedTo: string;
}

/** Per-target freshness in a sync plan (src/core/sync). `unwritable` marks a
 *  target the guard refuses — reported, never written. */
export type SyncStatus = 'new' | 'changed' | 'in-sync' | 'unwritable';

/**
 * One target row in a sync response (src/server/sync.ts). `diff` is the INTENDED
 * disclosure of the regenerated file — the preview the user approves — carried as
 * unified diff TEXT (empty when in-sync/unwritable). `runtimeIds`/`displayNames`
 * list every runtime that reads `path` (shared-file runtimes collapse to one
 * row). `committed`/`error` are present only on a commit response.
 */
export interface SyncTarget {
  runtimeIds: string[];
  displayNames: string[];
  path: string;
  pathScope?: string;
  status: SyncStatus;
  willCreate?: boolean;
  willModify?: boolean;
  diff: string;
  lossy: boolean;
  note?: string;
  committed?: boolean;
  error?: string;
}

/** POST /api/sync payload (dry-run OR commit; src/server/sync.ts). */
export interface SyncResponse {
  /** True on a dry-run response; absent on a commit response. */
  dryRun?: true;
  /** True when every writable, non-in-sync target committed; commit responses only. */
  committed?: boolean;
  /** Scope-relative source path the plan regenerated from. */
  source: string;
  targets: SyncTarget[];
}

/**
 * One catalog entry as SERVED by GET /api/catalog (src/server/catalog.ts). This
 * is METADATA ONLY — never file CONTENT (bodies can be large; the install flow
 * fetches + verifies them on demand and discloses them solely as the dry-run
 * diff). `key` is `<kind>/<name>`; `files` are the project-relative install
 * destinations. `description`/`name`/`source`/`tags`/paths are UNTRUSTED registry
 * text — render as text nodes only, never HTML.
 */
export interface CatalogEntryMeta {
  key: string;
  kind: string;
  name: string;
  description: string;
  version: string;
  source: string;
  tags: string[];
  files: string[];
}

/**
 * One installed entry's provenance record for the resolved instance
 * (src/server/provenance.ts, `InstallRecord`). Present for entries agentconfig
 * installed; drives the INSTALL vs REMOVE affordance and the installed badge.
 */
export interface InstalledRecord {
  key: string;
  kind: string;
  name: string;
  source: string;
  version: string;
  installedAt: string;
  files: string[];
}

/** GET /api/catalog payload — entry metadata + this instance's installed records. */
export interface CatalogResponse {
  entries: CatalogEntryMeta[];
  installed: InstalledRecord[];
}

/**
 * One file row in an install response (src/server/catalog.ts). `diff` is the
 * INTENDED disclosure of the (provenance-stamped, checksum-verified) content the
 * user approves — unified diff TEXT. `committed`/`error` appear only on a commit.
 */
export interface CatalogFileRow {
  path: string;
  pathScope: string;
  willCreate: boolean;
  willModify: boolean;
  diff: string;
  committed?: boolean;
  error?: string;
}

/** POST /api/catalog/install payload (dry-run OR commit; src/server/catalog.ts). */
export interface CatalogInstallResponse {
  dryRun?: true;
  committed?: boolean;
  entryKey: string;
  files: CatalogFileRow[];
  /** The provenance manifest that would be / was updated (dry-run only). */
  provenance?: { path: string; note: string };
}

/** One file row in a remove response (src/server/catalog.ts). */
export interface CatalogRemoveFile {
  path: string;
  /** True on a dry-run for a present recorded file. */
  willTrash?: boolean;
  /** True on a commit once trashed (recoverable). */
  trashed?: boolean;
  /** Where the file was moved (recover from here). */
  trashedTo?: string;
  /** A recorded file already gone / no longer in scope — reported, never trashed. */
  missing?: boolean;
}

/** POST /api/catalog/remove payload (dry-run OR commit; src/server/catalog.ts). */
export interface CatalogRemoveResponse {
  dryRun?: true;
  committed?: boolean;
  entryKey: string;
  files: CatalogRemoveFile[];
}

/**
 * One plugin from the Claude Code MARKETPLACE (src/server/marketplace.ts, bead
 * 0zm.5). This is the UNTRUSTED output of the `claude` CLI subprocess — other
 * people's plugin metadata. Every field (`name`/`description`/`source`/`id`/
 * `marketplace`) is text; render as text nodes only, never HTML. `installCount`
 * is present only when the CLI reports one.
 */
export interface MarketplacePlugin {
  /** `pluginId`, e.g. `foo@claude-plugins-official` — the install allowlist key. */
  id: string;
  name: string;
  description: string;
  version: string;
  installCount?: number;
  source: string;
  marketplace: string;
}

/** One installed Claude Code plugin (src/server/marketplace.ts). Text only. */
export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  scope: string;
  installedAt: string;
  source: string;
}

/**
 * GET /api/marketplace payload. A discriminated union on `available`: the
 * `claude` CLI may be ABSENT (or error/timeout) → `{ available:false, reason }`,
 * which the UI renders as a clear empty state rather than a failure. When present
 * it carries the browsable `plugins` plus the `installed` set.
 */
export type MarketplaceResponse =
  | { available: true; plugins: MarketplacePlugin[]; installed: InstalledPlugin[] }
  | { available: false; reason: string };

/** GET /api/marketplace/installed payload. */
export type InstalledPluginsResponse =
  { available: true; installed: InstalledPlugin[] } | { available: false; reason: string };

/** POST /api/marketplace/install payload — the one-click install result. */
export type InstallPluginResponse =
  | { available: true; installed: boolean; name: string; message: string }
  | { available: false; reason: string };

/** Normalized read-only provider inventory (src/server/extensions.ts). */
export type ExtensionProviderState =
  'supported' | 'detected' | 'unavailable' | 'unsupported' | 'error';

export type ExtensionKind = 'native' | 'config' | 'rules' | 'none';

export interface ExtensionCapabilities {
  list: boolean;
  detail: boolean;
  install: boolean;
  remove: boolean;
  update: boolean;
  enable: boolean;
  disable: boolean;
}

export interface ExtensionProvider {
  id: string;
  displayName: string;
  kind: ExtensionKind;
  state: ExtensionProviderState;
  scopes: string[];
  capabilities: ExtensionCapabilities;
  reason?: string;
}

export interface Extension {
  providerId: string;
  id: string;
  name: string;
  version: string;
  scope: string;
  source: string;
  enabled: boolean;
  kind?: ExtensionKind;
  path?: string;
}

export interface ExtensionInventoryResponse {
  providers: ExtensionProvider[];
  extensions: Extension[];
}

/**
 * GIT PANEL (bead ngs.1). These MIRROR src/server/git.ts. Every string —
 * branch/file/upstream names, commit subjects + authors — is UNTRUSTED git
 * output (a branch or commit could be crafted); render each as a TEXT node only.
 * `gitAvailable:false` means git is not installed; `isRepo:false` means the
 * instance root is not a git repository — both are graceful 200s, not errors.
 */

/** One changed file. `status` is the porcelain-v2 letter (M/A/D/R/C/U). */
export interface GitFileChange {
  path: string;
  status: string;
  orig?: string;
}

export interface GitCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
}

/** GET /api/git/status payload. */
export type GitStatusResponse =
  | { gitAvailable: false; isRepo: false }
  | { gitAvailable: true; isRepo: false }
  | {
      gitAvailable: true;
      isRepo: true;
      branch: string;
      detached: boolean;
      upstream?: string;
      ahead: number;
      behind: number;
      staged: GitFileChange[];
      unstaged: GitFileChange[];
      untracked: string[];
      /** Present only when the status command itself failed (timeout). */
      ok?: boolean;
      message?: string;
    };

/** GET /api/git/log payload. */
export type GitLogResponse =
  | { gitAvailable: false; isRepo: false }
  | { gitAvailable: true; isRepo: false }
  | { gitAvailable: true; isRepo: true; commits: GitCommit[] };

/** GET /api/git/branches payload. */
export type GitBranchesResponse =
  | { gitAvailable: false; isRepo: false }
  | { gitAvailable: true; isRepo: false }
  | { gitAvailable: true; isRepo: true; branches: GitBranch[] };

/** GET /api/git/diff payload — unified diff TEXT (parse + render as text nodes). */
export type GitDiffResponse =
  | { gitAvailable: false; isRepo: false }
  | { gitAvailable: true; isRepo: false }
  | { gitAvailable: true; isRepo: true; diff: string };

/**
 * A state-changing git op result (stage/unstage/commit/checkout/push/pull).
 * `ok:false` carries git's own (untrusted) message — a bad ref, no remote,
 * nothing to commit — a graceful 200, never a thrown error.
 */
export type GitMutationResponse =
  | { gitAvailable: false; isRepo: false }
  | { gitAvailable: true; isRepo: false }
  | { gitAvailable: true; isRepo: true; ok: boolean; message?: string };

/**
 * Server→client WebSocket push messages (src/server/watcher.ts,
 * `WatcherMessage`). A `report` push means the instance's config changed on disk
 * → the UI should refetch; `live-session` is a growing-session pulse.
 */
export type WsMessage =
  | { type: 'report'; instance: string; changed: string[] }
  | { type: 'live-session'; instance: string; sessionId: string };

/**
 * DASHBOARD STATS (bead 7yb.2). These MIRROR the server's serialized shapes
 * (src/core/stats/types.ts + src/server/stats-routes.ts). Every value is an
 * aggregate NUMBER or achievement METADATA — the server derives them by counting
 * messages / reasoning about timestamps, never by reading message content. The
 * only session-derived STRINGS (session titles, cwds) are adversarial log text;
 * render them as text nodes only.
 */

/** Message tallies by role across the scanned sessions. */
export interface MessageCounts {
  total: number;
  user: number;
  assistant: number;
}

/** Daily activity streaks (consecutive UTC days). */
export interface StreakStats {
  current: number;
  longest: number;
}

/** One heatmap cell: a UTC calendar day and its activity event count. */
export interface HeatmapCell {
  /** UTC `YYYY-MM-DD`. */
  date: string;
  count: number;
}

/** XP + level derived from lifetime activity. */
export interface XpStats {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** Progress toward the next level, 0..1. */
  levelProgress: number;
}

/** The dashboard stats bundle. All numbers are real, never invented. */
export interface DashboardStats {
  sessionCount: number;
  messageCounts: MessageCounts;
  promptCount: number;
  runtimes: string[];
  activeDays: number;
  streak: StreakStats;
  xp: XpStats;
  heatmap: HeatmapCell[];
  firstActiveDate?: string;
  lastActiveDate?: string;
}

/** Achievement grouping (cosmetic). */
export type AchievementCategory =
  'sessions' | 'messages' | 'streaks' | 'consistency' | 'progression';

/** Achievement METADATA as served — never the unlock criterion predicate. */
export interface AchievementMeta {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
}

/** Unlocked / locked partition of the achievement catalog. */
export interface AchievementsPayload {
  unlocked: AchievementMeta[];
  locked: AchievementMeta[];
}

/** GET /api/stats payload — aggregate stats + achievement metadata only. */
export interface StatsResponse {
  stats: DashboardStats;
  achievements: AchievementsPayload;
  /** Session files fully read this scan (≤ the cap). */
  sessionsScanned: number;
  /** Session files discovered before the cap was applied. */
  sessionsTotal: number;
  /** True when discovery exceeded the cap (totals are windowed). */
  capped: boolean;
}

/** One session's METADATA (no message content). Titles/cwds are text only. */
export interface SessionSummary {
  id: string;
  runtime: string;
  title: string;
  cwd: string;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  runtimeMs?: number;
  /** True when the session file is being actively appended (SPEC §4.4). */
  live: boolean;
  /** User-authored tags (local sidecar; may be empty). */
  tags: string[];
}

/** GET /api/sessions payload — a bounded, content-free session list. */
export interface SessionsResponse {
  sessions: SessionSummary[];
  sessionsTotal: number;
  capped: boolean;
}

/**
 * SESSION REPLAY (bead 7yb.3). One content block of a replayed message. All
 * secret-bearing strings (text/thinking/tool_result) are REDACTED server-side
 * (SPEC §3): `text` never holds a raw secret and `spans` locate each
 * `[REDACTED:*]` mark. Render EVERY field as a text node — never HTML. A
 * `tool_use` block carries only its structural kind + `name` (its input is
 * withheld server-side); `persistedOutputPath` is a REFERENCE the UI must never
 * fetch or open.
 */
export interface ReplayBlock {
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'unknown';
  text?: string;
  spans?: RedactionSpan[];
  name?: string;
  toolUseId?: string;
  persistedOutputPath?: string;
  blockType?: string;
}

/** One replayed message: structural fields + redacted content blocks. */
export interface ReplayMessage {
  role: 'user' | 'assistant';
  /** Subagent (sidechain) traffic — rendered distinctly (indented/badged). */
  isSidechain: boolean;
  isMeta: boolean;
  timestamp?: string;
  model?: string;
  uuid?: string;
  blocks: ReplayBlock[];
}

/**
 * GET /api/sessions/:id payload — ONE session's replay, PAGINATED. `messages` is
 * the window `[offset, offset+limit)`; `messageCount` is the session total.
 */
export interface SessionDetail {
  id: string;
  runtime: string;
  title: string;
  cwd: string;
  startedAt?: string;
  endedAt?: string;
  messageCount: number;
  offset: number;
  limit: number;
  messages: ReplayMessage[];
  live: boolean;
  tags: string[];
}

/** POST /api/sessions/:id/tags payload — the stored (sanitized) tag set. */
export interface SessionTagsResponse {
  id: string;
  tags: string[];
}

/**
 * SESSION SEARCH (bead 7yb.4). MIRRORS src/server/search.ts. The FTS index is
 * backed by the OPTIONAL better-sqlite3 native module: when it cannot load, every
 * search response is `{ available:false, reason }` (a 200) so the UI shows a clear
 * "search unavailable — optional dependency not installed" state.
 */

export type SearchMode = 'fts' | 'semantic';

/** One search hit. `snippet` is REDACTED server-side; `spans` locate the
 *  `[REDACTED:*]` marks. Render `snippet` as a TEXT node only. */
export interface SearchHit {
  sessionId: string;
  messageIndex: number;
  role: string;
  snippet: string;
  spans: RedactionSpan[];
  timestamp?: string;
}

/** GET /api/search payload. Discriminated on `available`. */
export type SearchResponse =
  | { available: false; reason: string }
  | {
      available: true;
      mode: SearchMode;
      query: string;
      results: SearchHit[];
      truncated: boolean;
      /** Present only for a semantic query — the opt-in flag state + reason. */
      semantic?: { enabled: boolean; reason: string };
    };

/** POST /api/search/reindex payload. */
export type SearchReindexResponse =
  | { available: false; reason: string }
  | {
      available: true;
      indexed: { sessions: number; messages: number };
      total: number;
      lastIndexedAt: string;
    };

/** GET /api/search/status payload. */
export type SearchStatusResponse =
  | { available: false; reason: string; embeddings: { enabled: boolean } }
  | {
      available: true;
      indexed: { sessions: number; messages: number };
      total: number;
      lastIndexedAt?: string;
      embeddings: { enabled: boolean };
    };

// ── EMBEDDED TERMINAL (ngs.2) ─────────────────────────────────────────────────

/** One validated launch target for a PTY (src/server/pty.ts, `ShellChoice`). */
export interface ShellChoice {
  /** Opaque id: `shell` (the user's $SHELL) or `cli:<kind>` (a detected CLI). */
  id: string;
  /** Human label (the binary basename / runtime CLI name). */
  label: string;
}

/** GET /api/pty/status payload (src/server/pty-routes.ts, `PtyStatus`). */
export interface PtyStatusResponse {
  /** True only when the launch was interactive AND node-pty is loadable. */
  available: boolean;
  /** Whether the server was launched interactively (a daemon has no terminal). */
  interactive: boolean;
  /** The validated launch choices for the instance (empty when unavailable). */
  shells: ShellChoice[];
  /** Present when unavailable — why (daemon mode / node-pty absent). */
  reason?: string;
}

// ── PIPELINES (E9, bead ira.2) ────────────────────────────────────────────────

/**
 * Wire mirror of the pure pipeline model (src/core/pipeline/types.ts). A pipeline
 * is UNTRUSTED user-authored config: node config carries bash scripts, urls, and
 * paths — every field is rendered as a TEXT NODE only, never markup. Kept in sync
 * with the server model (validated server-side before save and before run).
 */

/** The 14 node types (SPEC §5 row 12). */
export type PipelineNodeType =
  | 'prompt'
  | 'bash'
  | 'github-action'
  | 'http'
  | 'transform'
  | 'delay'
  | 'input'
  | 'output'
  | 'git'
  | 'filter'
  | 'read-file'
  | 'write-file'
  | 'notification'
  | 'json-extract';

/** Fields every node carries: `id` (graph key) + `name` ({{NodeName}} key). */
export interface PipelineNodeBase {
  id: string;
  name: string;
}

/** A single safe declarative transform op (NO eval — mirrors the core model). */
export type TransformOp =
  | { op: 'pick'; keys: string[] }
  | { op: 'omit'; keys: string[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'set'; key: string; value: string };

/** Comparison ops for the filter predicate (safe, fixed set). */
export type FilterOp = 'eq' | 'ne' | 'contains' | 'gt' | 'lt' | 'exists';

/** A safe filter predicate: compare one field against a literal by a fixed op. */
export interface FilterPredicate {
  field: string;
  op: FilterOp;
  value?: string | number | boolean;
}

export interface PromptNode extends PipelineNodeBase {
  type: 'prompt';
  prompt: string;
  model?: string;
}
export interface BashNode extends PipelineNodeBase {
  type: 'bash';
  script: string;
}
export interface GithubActionNode extends PipelineNodeBase {
  type: 'github-action';
  workflow: string;
  ref?: string;
}
export interface HttpNode extends PipelineNodeBase {
  type: 'http';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface TransformNode extends PipelineNodeBase {
  type: 'transform';
  operations: TransformOp[];
}
export interface DelayNode extends PipelineNodeBase {
  type: 'delay';
  ms: number;
}
export interface InputNode extends PipelineNodeBase {
  type: 'input';
}
export interface OutputNode extends PipelineNodeBase {
  type: 'output';
}
export interface GitNode extends PipelineNodeBase {
  type: 'git';
  subcommand: string;
  args?: string[];
}
export interface FilterNode extends PipelineNodeBase {
  type: 'filter';
  predicate: FilterPredicate;
}
export interface ReadFileNode extends PipelineNodeBase {
  type: 'read-file';
  path: string;
}
export interface WriteFileNode extends PipelineNodeBase {
  type: 'write-file';
  path: string;
  content: string;
}
export interface NotificationNode extends PipelineNodeBase {
  type: 'notification';
  message: string;
  level?: 'info' | 'warn' | 'error';
}
export interface JsonExtractNode extends PipelineNodeBase {
  type: 'json-extract';
  path: string;
}

/** The discriminated union of every node config. */
export type PipelineNode =
  | PromptNode
  | BashNode
  | GithubActionNode
  | HttpNode
  | TransformNode
  | DelayNode
  | InputNode
  | OutputNode
  | GitNode
  | FilterNode
  | ReadFileNode
  | WriteFileNode
  | NotificationNode
  | JsonExtractNode;

/** A directed edge: `from`'s output feeds `to`'s input (node ids). */
export interface PipelineEdge {
  from: string;
  to: string;
}

/** A complete pipeline graph. */
export interface Pipeline {
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

/** GET /api/pipelines list entry (metadata only). */
export interface PipelineSummary {
  id: string;
  name: string;
  nodeCount: number;
}

export interface PipelineListResponse {
  pipelines: PipelineSummary[];
}
export interface PipelineResponse {
  pipeline: Pipeline;
}
export interface SavePipelineResponse {
  id: string;
  saved: true;
}
export interface DeletePipelineResponse {
  id: string;
  removed: true;
}
export interface RunStartResponse {
  runId: string;
}

/** A node's live run status (mirrors the executor's NodeStatus). */
export type RunNodeStatus = 'pending' | 'running' | 'ok' | 'error';

/**
 * A REDACTED text field: `text` carries the value with every secret already
 * replaced server-side by a visible `[REDACTED:*]` mark, and `spans` locate each
 * mark within `text` for styling (mirrors src/core/redact). A raw secret never
 * crosses the wire — render `text` as text nodes only.
 */
export interface RedactedText {
  text: string;
  spans: RedactionSpan[];
}

/**
 * One node's state within a run snapshot / replay detail. `output` is the node's
 * recorded output REDACTED server-side (secret-never-on-wire, like session
 * replay) — `output.text` holds `[REDACTED:*]` marks, never a raw secret. Render
 * every field as a text node.
 */
export interface RunNodeState {
  nodeName: string;
  status: RunNodeStatus;
  output?: RedactedText;
  error?: string;
}

/**
 * GET /api/pipelines/runs/:runId — the polled live snapshot AND the run REPLAY
 * detail (a finished run read from durable history). Per-node output/error are
 * REDACTED server-side before this crosses the wire.
 */
export interface RunSnapshot {
  runId: string;
  pipelineId: string;
  status: 'running' | 'ok' | 'error';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  nodes: Record<string, RunNodeState>;
}

/** Per-node status tally for a run history row. */
export interface RunStatusCounts {
  ok: number;
  error: number;
  pending: number;
  running: number;
  total: number;
}

/**
 * One row of a pipeline's run HISTORY (GET /api/pipelines/:id/runs). METADATA
 * ONLY — status, timing, and per-node status counts; never output (fetch the
 * replay detail via {@link RunSnapshot} for that).
 */
export interface RunHistoryEntry {
  runId: string;
  pipelineId: string;
  status: 'running' | 'ok' | 'error';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  counts: RunStatusCounts;
}

/** GET /api/pipelines/:id/runs payload — most-recent runs, newest first. */
export interface RunHistoryResponse {
  runs: RunHistoryEntry[];
}

/**
 * A pipeline's SCHEDULE (bead ira.4). `cron` is a cron expression or a named
 * preset; the schedule only RUNS when a daemon (`agentconfiging daemon`) is up —
 * the interactive server just persists it. `instanceRoot` is the run's pinned
 * cwd/scope; `lastRunAt` is the epoch-ms of the most recent scheduled run.
 */
export interface PipelineSchedule {
  pipelineId: string;
  cron: string;
  enabled: boolean;
  instanceRoot: string;
  lastRunAt?: number;
}

/**
 * GET/POST /api/pipelines/:id/schedule payload — the saved schedule (null when
 * none is set) plus the computed next fire time in epoch ms (null when disabled
 * or unset).
 */
export interface ScheduleResponse {
  schedule: PipelineSchedule | null;
  nextRun: number | null;
}
