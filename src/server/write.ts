/**
 * write — the WRITE API routes (SPEC §4.3, bead agentconfig-gxo.3). Registered
 * into the hardened Hono app (src/server/app.ts) under `/api`, so every route
 * here INHERITS the committed middleware gates: Host allowlist, bearer token,
 * and — for the non-safe POST/DELETE methods — the same-origin Origin/CSRF
 * check. This module adds no gate of its own; it adds the path-guard + on-disk
 * discipline that makes a write safe once a request is authorized.
 *
 * ENDPOINTS (all under /api, all path-guarded via resolveWriteTarget):
 *  - POST /api/write   {path, content, dryRun}
 *      dryRun:true  → {diff, willCreate, willModify, pathScope}   NO disk touch
 *      dryRun:false → applies the write, then {committed, created|modified,
 *                     path, pathScope, diff}
 *  - POST /api/delete  {path, dryRun}
 *      dryRun:true  → {willTrash, path, pathScope, trashTarget}   NO disk touch
 *      dryRun:false → moves the file to trash, then {trashed, path, pathScope,
 *                     originalPath, trashedTo}
 *  - GET  /api/file?path=   → {path, content, spans, pathScope}
 *      Reads a single IN-SCOPE KNOWN config file for display. `content` is the
 *      REDACTED text (secrets replaced by visible `[REDACTED:*]` marks via the
 *      hardened src/core/redact catalogue); `spans` are the mark offsets over
 *      that text so the UI can style each mark. The RAW secret-bearing content
 *      NEVER crosses the wire — redaction happens here, server-side, so even the
 *      local UI never receives a secret in the clear (SPEC §3). A future
 *      authenticated "reveal" path is out of scope. Only ever serves files that
 *      pass the same path guard.
 *
 * ERROR DISCIPLINE (constant JSON bodies, no stack traces, no path echo that
 * could confirm out-of-scope existence):
 *  - 400 'bad request'  malformed body / bad path input
 *  - 403 'forbidden'    out-of-scope OR not-a-known-config-path (identical body
 *                       whether or not an out-of-scope path exists — no oracle)
 *  - 404 'not found'    modify/read/delete of an in-scope path that is absent
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { CAPS, redact, type Fix } from '../core/index.js';
import { unifiedDiff } from './diff.js';
import { resolveWriteTarget, type ResolvedTarget, type WriteScope } from './pathguard.js';
import type { InstanceRegistry } from './registry.js';
import { trashFile } from './trash.js';

export interface WriteRoutesConfig {
  scopes: WriteScope[];
  trashDir: string;
}

/** apply-fix needs the registry (to resolve the instance + recompute the fix)
 *  and the base scopes (its GLOBAL entries; the PROJECT scope is derived
 *  per-instance from the target instance's own root). */
export interface ApplyFixRoutesConfig {
  scopes: WriteScope[];
  registry: InstanceRegistry;
}

function jsonError(status: 400 | 403 | 404 | 409 | 413 | 500, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// O_NOFOLLOW makes the OS refuse to open a symlinked FINAL component (ELOOP),
// atomically — the TOCTOU backstop to the resolver's lstat tail-walk. Falls
// back to 0 (no-op) on platforms lacking it; the lstat-walk still guards there.
// Exported so sibling write surfaces (hooks-edit.ts) share the ONE definition.
export const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Existing regular file at `abs`? (a symlink here was already realpath'd). */
export function statFile(abs: string): fs.Stats | undefined {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a JSON object body, or undefined (never throws) for anything else.
 *  Shared with the sibling write surfaces (hooks-edit.ts). */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await req.json()) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The dry-run view of a single already-resolved write: what the diff shows and
 *  whether it creates or modifies. `refuse` marks an in-scope path that exists
 *  but is not a regular file (a dir) — a 403, never an EISDIR. */
export interface EditPreview {
  willCreate: boolean;
  willModify: boolean;
  diff: string;
}

export function previewResolved(
  resolved: ResolvedTarget,
  content: string,
): EditPreview | { refuse: true } {
  const existing = statFile(resolved.absPath);
  if (fs.existsSync(resolved.absPath) && !existing) return { refuse: true };
  const oldContent = existing ? fs.readFileSync(resolved.absPath, 'utf-8') : '';
  const willModify = existing !== undefined;
  return {
    willModify,
    willCreate: !willModify,
    // Redacted before it can reach any response: the old side is raw disk
    // bytes, and an unredacted diff is a disclosure oracle that defeats the
    // GET /api/file redaction guarantee (a dry-run write with empty content
    // would echo the entire raw file).
    diff: redact(unifiedDiff(oldContent, content, resolved.relPath)).text,
  };
}

/**
 * Commit a single already-resolved target through THE guarded write path (the
 * one write primitive): mkdir the parent, then open the leaf with O_NOFOLLOW so
 * a symlink swapped in after the guard's lstat-walk is refused atomically by the
 * OS (ELOOP) rather than followed out of scope. Throws that ELOOP for the caller
 * to map to a 403 — apply-fix and /api/write share this exact code so neither
 * can drift into a second, weaker write.
 */
export function commitResolved(resolved: ResolvedTarget, content: string): void {
  fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
  const fd = fs.openSync(
    resolved.absPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW,
    0o644,
  );
  try {
    fs.writeFileSync(fd, content, 'utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

export function registerWriteRoutes(app: Hono, config: WriteRoutesConfig): void {
  const { scopes, trashDir } = config;

  app.post('/api/write', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const { path: reqPath, content, dryRun } = body;
    if (typeof content !== 'string') return jsonError(400, 'bad request');
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');
    if (Buffer.byteLength(content, 'utf-8') > CAPS.maxFileBytes)
      return jsonError(400, 'bad request');

    const resolved = resolveWriteTarget(reqPath, scopes);
    if (!resolved.ok)
      return jsonError(resolved.status, resolved.status === 400 ? 'bad request' : 'forbidden');

    const preview = previewResolved(resolved, content);
    if ('refuse' in preview) return jsonError(403, 'forbidden');

    if (dryRun !== false) {
      return c.json({
        diff: preview.diff,
        willCreate: preview.willCreate,
        willModify: preview.willModify,
        pathScope: resolved.scope.kind,
      });
    }

    try {
      commitResolved(resolved, content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ELOOP') return jsonError(403, 'forbidden');
      throw err;
    }
    return c.json({
      committed: true,
      created: preview.willCreate,
      modified: preview.willModify,
      path: resolved.relPath,
      pathScope: resolved.scope.kind,
      diff: preview.diff,
    });
  });

  app.post('/api/delete', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const { path: reqPath, dryRun } = body;
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    const resolved = resolveWriteTarget(reqPath, scopes);
    if (!resolved.ok)
      return jsonError(resolved.status, resolved.status === 400 ? 'bad request' : 'forbidden');

    // In-scope existence is not secret (the guard already refused everything
    // out-of-scope with an identical 403), so a 404 here is fine.
    if (!statFile(resolved.absPath)) return jsonError(404, 'not found');

    if (dryRun !== false) {
      return c.json({
        willTrash: true,
        path: resolved.relPath,
        pathScope: resolved.scope.kind,
        trashTarget: trashDir,
      });
    }

    const result = trashFile(resolved.absPath, resolved.relPath, trashDir);
    return c.json({
      trashed: true,
      path: resolved.relPath,
      pathScope: resolved.scope.kind,
      originalPath: result.originalPath,
      trashedTo: result.trashedTo,
    });
  });

  app.get('/api/file', (c) => {
    const reqPath = new URL(c.req.url).searchParams.get('path');
    const resolved = resolveWriteTarget(reqPath, scopes);
    if (!resolved.ok)
      return jsonError(resolved.status, resolved.status === 400 ? 'bad request' : 'forbidden');

    const st = statFile(resolved.absPath);
    if (!st) return jsonError(404, 'not found');
    // Byte cap parity with the write path: don't read + redact an arbitrarily
    // large in-scope file into memory per request.
    if (st.size > CAPS.maxFileBytes) return jsonError(413, 'file too large');

    // O_NOFOLLOW backstop: refuse a symlinked leaf (TOCTOU swap after the
    // guard) rather than read through it to an out-of-scope target.
    let fd: number;
    try {
      fd = fs.openSync(resolved.absPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP') return jsonError(403, 'forbidden');
      if (code === 'ENOENT') return jsonError(404, 'not found');
      throw err;
    }
    try {
      const raw = fs.readFileSync(fd, 'utf-8');
      // Redact BEFORE serializing: the raw secret must never leave the process,
      // even to the same-machine UI. `content` carries the marked text; `spans`
      // let the renderer highlight each `[REDACTED:*]` mark.
      const { text, spans } = redact(raw);
      return c.json({
        path: resolved.relPath,
        content: text,
        spans,
        pathScope: resolved.scope.kind,
      });
    } finally {
      fs.closeSync(fd);
    }
  });
}

/**
 * ONE result row per fix edit — the dry-run preview and the commit report share
 * this shape (commit adds `committed`, and `error` when a per-edit write failed).
 */
interface FixEditResult {
  path: string;
  pathScope: string;
  willCreate: boolean;
  willModify: boolean;
  diff: string;
  committed?: boolean;
  error?: string;
}

/**
 * POST /api/apply-fix {instance?, findingId, dryRun?} — the one-click APPLY for a
 * finding's machine fix (SPEC §4.1 + §4.3, bead agentconfig-wmc.1). Registered
 * under /api, so it INHERITS the token + Origin/CSRF gates (see app.ts).
 *
 * WHY A SERVER ENDPOINT: the fix's `edits[].patch` (complete replacement file
 * content, possibly secret-bearing) is STRIPPED before any report crosses the
 * wire ([[fix-patch-carries-content]]) — the client only ever sees hasFix/
 * fixKind. So APPLY cannot send the patch; it names the finding and the server
 * recomputes the fix from a fresh (cached) report, then:
 *   - dryRun (default): returns the unified DIFF for every edit, touching NOTHING.
 *     The diff — current on-disk content vs the fix patch — is the INTENDED and
 *     only disclosure of patch content: the user sees exactly what they approve.
 *   - commit: applies each edit through resolveWriteTarget + commitResolved, the
 *     SAME guarded write path a user write takes. A fix edit path is NO more
 *     trusted than a user edit: it must pass input discipline, scope containment,
 *     the config allowlist, and the symlink/O_NOFOLLOW defenses. An edit that
 *     resolves out of scope refuses the WHOLE fix (403) before any write lands.
 *
 * ERRORS (constant bodies, no path echo): 400 malformed; 404 unknown instance OR
 * unknown/fixless findingId (indistinguishable — no oracle); 403 an edit path the
 * guard refuses; 409 the fix's precondition no longer holds (a 'create-file'
 * whose target now exists, or a 'replace-file' whose target is gone) — refused
 * rather than clobbering / creating unexpectedly.
 */
export function registerApplyFixRoute(app: Hono, config: ApplyFixRoutesConfig): void {
  const { scopes, registry } = config;
  // Global (agent-home) scopes are instance-independent; the project scope is
  // the TARGET instance's own root (fix edit paths are project-relative to it).
  const globalScopes = scopes.filter((s) => s.kind === 'global');

  app.post('/api/apply-fix', async (c) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const { instance: instanceSel, findingId, dryRun } = body;
    if (typeof findingId !== 'string' || findingId === '') return jsonError(400, 'bad request');
    if (instanceSel !== undefined && typeof instanceSel !== 'string')
      return jsonError(400, 'bad request');
    if (dryRun !== undefined && typeof dryRun !== 'boolean') return jsonError(400, 'bad request');

    // Resolve ONLY against registered instances — never a scan of an arbitrary
    // path (see registry.resolve). Unknown selector → 404.
    const instance = registry.resolve(instanceSel ?? undefined);
    if (!instance) return jsonError(404, 'not found');

    let fix: Fix | undefined;
    let store: ReturnType<InstanceRegistry['load']>;
    try {
      store = registry.load(instance);
      fix = store.fixFor('project', findingId);
    } catch (err) {
      console.error(`agentconfiging server: apply-fix report failed: ${String(err)}`);
      return jsonError(500, 'apply failed');
    }
    // Unknown finding id AND a finding that carries no fix both land here — the
    // same 404, no oracle for which findings exist or are fixable.
    if (!fix) return jsonError(404, 'not found');

    const instanceScopes: WriteScope[] = [
      { root: instance.root, kind: 'project' },
      ...globalScopes,
    ];

    // Resolve + preview EVERY edit BEFORE writing any: a single out-of-scope /
    // non-config / oversized edit refuses the whole fix, so a multi-edit fix
    // never leaves a partial write behind on a guard failure.
    const resolved: { target: ResolvedTarget; patch: string; preview: EditPreview }[] = [];
    for (const edit of fix.edits) {
      if (Buffer.byteLength(edit.patch, 'utf-8') > CAPS.maxFileBytes)
        return jsonError(400, 'bad request');
      const target = resolveWriteTarget(edit.path, instanceScopes);
      if (!target.ok)
        return jsonError(target.status, target.status === 400 ? 'bad request' : 'forbidden');
      const preview = previewResolved(target, edit.patch);
      if ('refuse' in preview) return jsonError(403, 'forbidden');

      // Honor the Fix.kind PRECONDITION (src/core findings.ts): 'create-file'
      // requires the target to be absent; 'replace-file' requires it to exist.
      // A fix patch is the COMPLETE file body, so a 'create-file' whose target
      // already exists would silently CLOBBER it — refuse instead. This also
      // catches an analyzer that emitted a create-file for a file the ENGINE
      // could not see (e.g. `.gitignore`, which the scanner never collects) but
      // that is present on disk: applying it would destroy real content.
      const precondition = fix.kind === 'create-file' ? preview.willCreate : preview.willModify;
      if (!precondition) return jsonError(409, 'conflict');

      resolved.push({ target, patch: edit.patch, preview });
    }

    const rows = (): FixEditResult[] =>
      resolved.map(({ target, preview }) => ({
        path: target.relPath,
        pathScope: target.scope.kind,
        willCreate: preview.willCreate,
        willModify: preview.willModify,
        diff: preview.diff,
      }));

    if (dryRun !== false) {
      return c.json({ dryRun: true, findingId, fixKind: fix.kind, edits: rows() });
    }

    // COMMIT: apply each through the guarded write path. Best-effort with clear
    // per-edit reporting — true cross-file atomicity is not achievable, so a
    // mid-sequence failure (e.g. a TOCTOU symlink swap → ELOOP) is recorded and
    // stops further writes rather than being masked.
    const edits: FixEditResult[] = [];
    let allOk = true;
    for (const { target, patch, preview } of resolved) {
      const row: FixEditResult = {
        path: target.relPath,
        pathScope: target.scope.kind,
        willCreate: preview.willCreate,
        willModify: preview.willModify,
        diff: preview.diff,
      };
      try {
        commitResolved(target, patch);
        row.committed = true;
      } catch (err) {
        allOk = false;
        row.committed = false;
        row.error = (err as NodeJS.ErrnoException).code === 'ELOOP' ? 'forbidden' : 'write failed';
        edits.push(row);
        break;
      }
      edits.push(row);
    }

    // The applied fix changes disk → drop the cached report so the immediate
    // refetch re-scans and the resolved finding disappears (the watcher will
    // also invalidate + push, but this makes the APPLY→refetch loop deterministic).
    store.invalidate('project');
    return c.json({ committed: allOk, findingId, edits });
  });
}
