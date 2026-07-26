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
  buildReport,
  detect,
  scanProject,
  toReportFinding,
  type DetectedAgent,
  type Fix,
  type ManifestStats,
  type ReportFinding,
  type ScanOptions,
} from '../core/index.js';

/** Scopes the API can report on. v1 is project-only; 'global' is a later bead. */
export type ReportScope = 'project';

/** One scope's report as served by GET /api/report — paths/metadata/findings only. */
export interface ServedReport {
  version: string;
  generatedAt: string;
  root: string;
  scope: 'project' | 'global';
  localOnly: boolean;
  agents: DetectedAgent[];
  findings: ReportFinding[];
  stats: ManifestStats;
}

export class ReportStore {
  readonly #root: string;
  readonly #version: string;
  readonly #scanOptions: ScanOptions;
  readonly #cache = new Map<ReportScope, ServedReport>();
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

  /** Drop cached reports + fixes (one scope, or all). Watcher-bead hook. */
  invalidate(scope?: ReportScope): void {
    if (scope) {
      this.#cache.delete(scope);
      this.#fixes.delete(scope);
    } else {
      this.#cache.clear();
      this.#fixes.clear();
    }
  }

  /** Scan + analyze once, populating BOTH the served-report cache and the
   *  (server-internal) fix cache from the single computation, then return the
   *  served report. */
  #build(scope: ReportScope): ServedReport {
    const manifest = scanProject(this.#root, this.#scanOptions);
    const agents = detect(manifest);
    const { findings } = buildReport(manifest, agents);
    const report: ServedReport = {
      version: this.#version,
      generatedAt: new Date().toISOString(),
      root: manifest.root,
      scope: manifest.scope ?? 'project',
      localOnly: manifest.localOnly ?? false,
      agents,
      findings: findings.map(toReportFinding),
      stats: manifest.stats,
    };
    const fixes = new Map<string, Fix>();
    for (const finding of findings) if (finding.fix) fixes.set(finding.id, finding.fix);
    this.#cache.set(scope, report);
    this.#fixes.set(scope, fixes);
    return report;
  }
}
