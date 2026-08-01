/**
 * ReportStore — cached engine runs for the server API (agentconfig-gxo.2).
 *
 * Holds one report per scope (v1: 'project' only), computed lazily from the
 * pure core pipeline (scanProject → detect → buildReport) and cached until
 * `fresh` is requested or `invalidate()` is called. The watcher bead
 * (agentconfig-gxo.4) will call `invalidate()` on file-system changes.
 *
 * Output is CONTENT-FREE, matching the CLI report contract: findings pass
 * through `toReportFinding` (src/core/report.ts) so `fix.edits[].patch` —
 * complete replacement file content, potentially secret-bearing — is never
 * serialized, only summarized as `hasFix`/`fixKind`.
 *
 * No env bag is passed to the analyzers here (PATH facts are a CLI concern;
 * absent facts make those checks skip, never guess — SPEC §4.1).
 */

import {
  buildGlobalEntries,
  buildReport,
  computeContextCost,
  computeContextHealth,
  detect,
  scanProject,
  toReportFinding,
  type ContextCost,
  type ContextHealth,
  type ContextCostOptions,
  type AgentConfigQuality,
  type DetectedAgent,
  type Fix,
  type GlobalEntry,
  type GlobalEntryError,
  type ManifestStats,
  type ReportFinding,
  type ScanOptions,
} from '../core/index.js';

/** Scopes a per-instance ReportStore serves — project-only by design; the
 *  machine-global report lives in the server-owned {@link GlobalStore}. */
export type ReportScope = 'project';

/** One scope's report as served by GET /api/report — paths/metadata/findings only. */
export interface ServedReport {
  version: string;
  generatedAt: string;
  root: string;
  scope: 'project' | 'global';
  localOnly: boolean;
  agents: DetectedAgent[];
  quality: AgentConfigQuality;
  findings: ReportFinding[];
  stats: ManifestStats;
}

export class ReportStore {
  readonly #root: string;
  readonly #version: string;
  readonly #scanOptions: ScanOptions;
  readonly #cache = new Map<ReportScope, ServedReport>();
  /**
   * Per-scope CONTEXT-HEALTH view (bead 7yb.6): a pure, content-free
   * computation over the SAME scanned manifest that produced the report (sizes
   * + paths + suggestions, never file bodies). Cached alongside `#cache` and
   * populated in the single `#build` pass, so it costs no extra scan.
   */
  readonly #contextHealth = new Map<ReportScope, ContextHealth>();
  /** Per-scope CONTEXT-COST view (agentconfig-ub3.2), cached with report data. */
  readonly #contextCost = new Map<ReportScope, ContextCost>();
  /**
   * Per-scope map of finding id → fix payload. SERVER-INTERNAL by design: it
   * holds the `fix.edits[].patch` (complete replacement file content, possibly
   * secret-bearing) that {@link toReportFinding} strips from `#cache`. It is
   * NEVER serialized to a client except through the guarded apply-fix diff
   * preview (agentconfig-wmc.1) — see {@link fixFor}.
   */
  readonly #fixes = new Map<ReportScope, Map<string, Fix>>();

  /**
   * `scanOptions` overrides the engine walk bounds (agentconfig-gxo.6);
   * production omits it (CAPS defaults apply). It exists so a system-root-
   * style over-cap scan can be exercised end-to-end as a fast typed
   * E_TOO_MANY_DIRS error rather than a hang.
   */
  constructor(root: string, version: string, scanOptions: ScanOptions = {}) {
    this.#root = root;
    this.#version = version;
    this.#scanOptions = scanOptions;
  }

  /**
   * Return the cached report for `scope`, computing it on first access or
   * when `fresh` is set. Throws (e.g. ScanError) when the scan fails — the
   * route maps that to a 500 without leaking details.
   */
  get(scope: ReportScope, opts: { fresh?: boolean } = {}): ServedReport {
    if (!opts.fresh) {
      const hit = this.#cache.get(scope);
      if (hit) return hit;
    }
    return this.#build(scope);
  }

  /**
   * The fix payload for a finding id in `scope`, or undefined when the id is
   * unknown OR the finding carries no fix (the caller cannot tell which — no
   * oracle). SERVER-INTERNAL: the returned patch content only ever reaches a
   * client through the apply-fix DIFF PREVIEW (agentconfig-wmc.1), never a bulk
   * serialization. Computes the report on first access, mirroring {@link get}.
   */
  fixFor(scope: ReportScope, findingId: string, opts: { fresh?: boolean } = {}): Fix | undefined {
    if (opts.fresh || !this.#fixes.has(scope)) this.#build(scope);
    return this.#fixes.get(scope)?.get(findingId);
  }

  /**
   * The content-free context-health view for `scope`, computed on first access
   * or when `fresh` is set (mirrors {@link get}). Reuses the cached manifest
   * computation — no extra scan.
   */
  contextHealth(scope: ReportScope, opts: { fresh?: boolean } = {}): ContextHealth {
    if (!opts.fresh) {
      const hit = this.#contextHealth.get(scope);
      if (hit) return hit;
    }
    this.#build(scope);
    return this.#contextHealth.get(scope) as ContextHealth;
  }

  /**
   * The per-agent initial-context token-cost view for `scope`, computed on
   * first access or when `fresh` is set (mirrors {@link get}). Reuses the same
   * scan/detect pass as the report and context-health caches.
   */
  contextCost(
    scope: ReportScope,
    opts: { fresh?: boolean } & ContextCostOptions = {},
  ): ContextCost {
    if (!opts.fresh) {
      const hit = this.#contextCost.get(scope);
      if (hit) return hit;
    }
    this.#build(scope, opts);
    return this.#contextCost.get(scope) as ContextCost;
  }

  /** Drop cached reports + fixes (one scope, or all). Watcher-bead hook. */
  invalidate(scope?: ReportScope): void {
    if (scope) {
      this.#cache.delete(scope);
      this.#fixes.delete(scope);
      this.#contextHealth.delete(scope);
      this.#contextCost.delete(scope);
    } else {
      this.#cache.clear();
      this.#fixes.clear();
      this.#contextHealth.clear();
      this.#contextCost.clear();
    }
  }

  /** Scan + analyze once, populating BOTH the served-report cache and the
   *  (server-internal) fix cache from the single computation, then return the
   *  served report. */
  #build(scope: ReportScope, contextCostOptions: ContextCostOptions = {}): ServedReport {
    const manifest = scanProject(this.#root, this.#scanOptions);
    const agents = detect(manifest);
    const { findings, quality } = buildReport(manifest, agents);
    const report: ServedReport = {
      version: this.#version,
      generatedAt: new Date().toISOString(),
      root: manifest.root,
      scope: manifest.scope ?? 'project',
      localOnly: manifest.localOnly ?? false,
      agents,
      quality,
      findings: findings.map(toReportFinding),
      stats: manifest.stats,
    };
    const fixes = new Map<string, Fix>();
    for (const finding of findings) if (finding.fix) fixes.set(finding.id, finding.fix);
    this.#cache.set(scope, report);
    this.#fixes.set(scope, fixes);
    this.#contextHealth.set(scope, computeContextHealth(manifest));
    this.#contextCost.set(scope, computeContextCost(manifest, agents, contextCostOptions));
    return report;
  }
}

/** The machine-global report as served by GET /api/report?scope=global. */
export interface ServedGlobalReport {
  version: string;
  generatedAt: string;
  scope: 'global';
  /** Always true: global config is THIS machine's home dirs, never remote. */
  localOnly: true;
  entries: (GlobalEntry | GlobalEntryError)[];
}

/**
 * GlobalStore — the server-owned machine-global report cache (agentconfig-71h.2).
 *
 * ONE per server, NOT per instance: the global scope is instance-independent.
 * What it scans is a FIXED server-side set — core KNOWN_DIRS under the home
 * dir resolved ONCE at construction (os.homedir() in production, a fixture
 * home in tests) — no request parameter ever influences the roots.
 *
 * Follows ReportStore's caching discipline: computed lazily on first access,
 * cached until `fresh` is requested. Entries come from the shared core
 * composition (buildGlobalEntries), which is CONTENT-FREE by construction —
 * findings pass through toReportFinding (hasFix/fixKind only, never
 * fix.edits[].patch) and a per-dir scan failure becomes an inline error entry
 * instead of killing its siblings.
 *
 * Deliberately NO fix cache here: POST /api/apply-fix resolves finding ids
 * only against a project instance's ReportStore, so a global finding id can
 * never be applied (→ 404). No env bag either, matching ReportStore.
 */
export class GlobalStore {
  readonly #homeDir: string;
  readonly #version: string;
  #cache: ServedGlobalReport | undefined;

  constructor(homeDir: string, version: string) {
    this.#homeDir = homeDir;
    this.#version = version;
  }

  /**
   * Return the cached global report, computing it on first access or when
   * `fresh` is set. Throws only on an engine bug (per-dir scan failures are
   * inline error entries) — the route maps that to a 500 without details.
   */
  get(opts: { fresh?: boolean } = {}): ServedGlobalReport {
    if (!opts.fresh && this.#cache) return this.#cache;
    this.#cache = {
      version: this.#version,
      generatedAt: new Date().toISOString(),
      scope: 'global',
      localOnly: true,
      entries: buildGlobalEntries(this.#homeDir),
    };
    return this.#cache;
  }
}
