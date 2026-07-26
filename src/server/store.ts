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
    const report = this.#build();
    this.#cache.set(scope, report);
    return report;
  }

  /** Drop cached reports (one scope, or all). Watcher-bead hook. */
  invalidate(scope?: ReportScope): void {
    if (scope) this.#cache.delete(scope);
    else this.#cache.clear();
  }

  #build(): ServedReport {
    const manifest = scanProject(this.#root, this.#scanOptions);
    const agents = detect(manifest);
    const { findings } = buildReport(manifest, agents);
    return {
      version: this.#version,
      generatedAt: new Date().toISOString(),
      root: manifest.root,
      scope: manifest.scope ?? 'project',
      localOnly: manifest.localOnly ?? false,
      agents,
      findings: findings.map(toReportFinding),
      stats: manifest.stats,
    };
  }
}
