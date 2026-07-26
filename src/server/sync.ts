/**
 * sync — POST /api/sync, the INSTRUCTION SYNC endpoint (SPEC §4.1 + §5 row 22,
 * bead agentconfig-wmc.10). Registered under `/api`, so it INHERITS the hardened
 * app's gates (Host allowlist, bearer token, same-origin/CSRF check). It adds no
 * gate of its own; it adds the path-guard + write discipline that makes a
 * multi-runtime regeneration safe once a request is authorized.
 *
 * WHAT IT DOES: given a designated SOURCE OF TRUTH (an instruction file in the
 * instance) and a set of TARGET runtimes, it regenerates each target's primary
 * instruction file from the source using the pure engine (src/core/sync), then:
 *   - dryRun (default): returns per-target unified DIFFS + sync status, no disk
 *     touch. The diff is the INTENDED disclosure — the user sees exactly what
 *     each regenerated file becomes before approving.
 *   - commit: writes each writable, non-in-sync target through the SAME guarded
 *     write path a user write takes (resolveWriteTarget + commitResolved — the
 *     ONE write primitive; never a second, weaker one).
 *
 * SECURITY MODEL (why a sync can never write outside scope):
 *  - The SOURCE path is untrusted: it is resolved + read through the guard
 *    (resolveWriteTarget) and read with O_NOFOLLOW. Out-of-scope / not-a-known-
 *    config-path → 403; absent → 404.
 *  - Each TARGET path is derived from the RUNTIME_FORMATS table but is STILL
 *    passed through resolveWriteTarget against the per-instance scopes. Only a
 *    target that clears the guard (scope containment, traversal, symlink/
 *    O_NOFOLLOW, config allowlist) is ever written; any other is reported as
 *    `unwritable` and skipped — never written. The guard's allowlist was
 *    extended ADDITIVELY (pathguard.ts SYNC_TARGET_FILES) to the exact runtime
 *    instruction paths, so long-tail targets (.clinerules, .windsurfrules, …)
 *    pass legitimately without widening anything else.
 *  - Every generated body is byte-capped like any write.
 *
 * ERRORS (constant bodies, no path echo): 400 malformed body / bad source path /
 * no valid targets; 404 unknown instance OR absent source; 403 source out of
 * scope; 413 source too large.
 */

import fs from 'node:fs';
import type { Hono } from 'hono';
import { CAPS } from '../core/index.js';
import { getRuntimeFormat, listSyncTargets } from '../core/runtimes/index.js';
import type { RuntimeFormat } from '../core/runtimes/index.js';
import { syncPlan, type SyncStatus } from '../core/sync/index.js';
import { resolveWriteTarget, type ResolvedTarget, type WriteScope } from './pathguard.js';
import type { InstanceRegistry } from './registry.js';
import { commitResolved, previewResolved, statFile } from './write.js';

export interface SyncRoutesConfig {
  scopes: WriteScope[];
  registry: InstanceRegistry;
}

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function jsonError(status: 400 | 403 | 404 | 413 | 500, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await req.json()) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Read an already-resolved, in-scope file with O_NOFOLLOW (TOCTOU backstop). */
function readResolved(resolved: ResolvedTarget): string | { error: 403 | 404 } {
  let fd: number;
  try {
    fd = fs.openSync(resolved.absPath, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') return { error: 403 };
    return { error: 404 };
  }
  try {
    return fs.readFileSync(fd, 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/** One target row as served (dry-run + commit share the shape; commit adds committed/error). */
interface SyncTargetRow {
  runtimeIds: string[];
  displayNames: string[];
  /** Scope-relative path when resolved; the requested target path otherwise. */
  path: string;
  pathScope?: string;
  status: SyncStatus | 'unwritable';
  willCreate?: boolean;
  willModify?: boolean;
  /** Unified diff TEXT (empty when in-sync or unwritable). Render as text nodes. */
  diff: string;
  lossy: boolean;
  note?: string;
  committed?: boolean;
  error?: string;
}

/** A planned target paired with its guard resolution + generated content. */
interface PlannedTarget {
  row: SyncTargetRow;
  /** The write target when the guard passed; undefined for unwritable rows. */
  resolved?: ResolvedTarget;
  content: string;
}

function resolveTargets(input: unknown): RuntimeFormat[] | undefined {
  if (input === undefined) return listSyncTargets();
  if (!Array.isArray(input)) return undefined;
  const out: RuntimeFormat[] = [];
  for (const id of input) {
    if (typeof id !== 'string') return undefined;
    const rt = getRuntimeFormat(id);
    if (rt) out.push(rt);
  }
  return out;
}

export function registerSyncRoute(app: Hono, config: SyncRoutesConfig): void {
  const { scopes, registry } = config;
  const globalScopes = scopes.filter((s) => s.kind === 'global');

  app.post('/api/sync', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const { instance: instanceSel, sourcePath, targets, dryRun } = body;
    if (typeof sourcePath !== 'string' || sourcePath === '') return jsonError(400, 'bad request');
    if (instanceSel !== undefined && typeof instanceSel !== 'string')
      return jsonError(400, 'bad request');
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    const targetFormats = resolveTargets(targets);
    if (targetFormats === undefined) return jsonError(400, 'bad request');
    if (targetFormats.length === 0) return jsonError(400, 'bad request');

    const instance = registry.resolve(instanceSel ?? undefined);
    if (!instance) return jsonError(404, 'not found');

    const instanceScopes: WriteScope[] = [
      { root: instance.root, kind: 'project' },
      ...globalScopes,
    ];

    // SOURCE: resolve + read through the guard (untrusted path).
    const src = resolveWriteTarget(sourcePath, instanceScopes);
    if (!src.ok) return jsonError(src.status, src.status === 400 ? 'bad request' : 'forbidden');
    const srcStat = statFile(src.absPath);
    if (!srcStat) return jsonError(404, 'not found');
    if (srcStat.size > CAPS.maxFileBytes) return jsonError(413, 'file too large');
    const sourceContent = readResolved(src);
    if (typeof sourceContent !== 'string')
      return jsonError(
        sourceContent.error,
        sourceContent.error === 403 ? 'forbidden' : 'not found',
      );

    // PLAN (pure) → then guard + preview each target on the disk-facing side.
    const plan = syncPlan({ path: src.relPath, content: sourceContent }, targetFormats);
    const planned: PlannedTarget[] = plan.map((entry) => {
      const base = {
        runtimeIds: entry.runtimeIds,
        displayNames: entry.displayNames,
        lossy: entry.lossy,
        ...(entry.note !== undefined ? { note: entry.note } : {}),
      };
      // A generated body over the cap, or a target the guard refuses, is
      // surfaced as unwritable — reported, never written (a sync never escapes scope).
      if (Buffer.byteLength(entry.content, 'utf-8') > CAPS.maxFileBytes) {
        return {
          row: { ...base, path: entry.path, status: 'unwritable', diff: '', error: 'too large' },
          content: entry.content,
        };
      }
      const target = resolveWriteTarget(entry.path, instanceScopes);
      if (!target.ok) {
        return {
          row: { ...base, path: entry.path, status: 'unwritable', diff: '' },
          content: entry.content,
        };
      }
      const preview = previewResolved(target, entry.content);
      if ('refuse' in preview) {
        return {
          row: { ...base, path: target.relPath, status: 'unwritable', diff: '' },
          content: entry.content,
        };
      }
      // previewResolved already read the on-disk target: an empty diff on an
      // existing file means it is byte-identical to what we would write.
      const status: SyncStatus = preview.willCreate
        ? 'new'
        : preview.diff === ''
          ? 'in-sync'
          : 'changed';
      return {
        resolved: target,
        content: entry.content,
        row: {
          ...base,
          path: target.relPath,
          pathScope: target.scope.kind,
          status,
          willCreate: preview.willCreate,
          willModify: preview.willModify,
          diff: preview.diff,
        },
      };
    });

    if (dryRun !== false) {
      return c.json({ dryRun: true, source: src.relPath, targets: planned.map((p) => p.row) });
    }

    // COMMIT: write each writable, non-in-sync target through the guarded path.
    // Dedupe by absolute path (shared-file runtimes already collapse in the
    // engine, but a belt-and-braces guard against writing one file twice).
    const written = new Set<string>();
    let allOk = true;
    for (const p of planned) {
      if (!p.resolved || p.row.status === 'in-sync' || p.row.status === 'unwritable') continue;
      if (written.has(p.resolved.absPath)) {
        p.row.committed = true;
        continue;
      }
      try {
        commitResolved(p.resolved, p.content);
        p.row.committed = true;
        written.add(p.resolved.absPath);
      } catch (err) {
        allOk = false;
        p.row.committed = false;
        p.row.error =
          (err as NodeJS.ErrnoException).code === 'ELOOP' ? 'forbidden' : 'write failed';
        break;
      }
    }

    // Disk changed → drop the cached report so the next fetch re-scans and the
    // resolved drift findings disappear.
    try {
      registry.load(instance).invalidate('project');
    } catch {
      // A load failure here is non-fatal to the write that already landed.
    }

    return c.json({ committed: allOk, source: src.relPath, targets: planned.map((p) => p.row) });
  });
}
