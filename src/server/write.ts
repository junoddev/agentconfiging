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
 *  - GET  /api/file?path=   → {path, content, pathScope}
 *      Reads a single IN-SCOPE KNOWN config file for the editor. Returns RAW
 *      content (redaction is a render concern the UI applies); only ever serves
 *      files that pass the same path guard.
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
import { CAPS } from '../core/index.js';
import { unifiedDiff } from './diff.js';
import { resolveWriteTarget, type WriteScope } from './pathguard.js';
import { trashFile } from './trash.js';

export interface WriteRoutesConfig {
  scopes: WriteScope[];
  trashDir: string;
}

function jsonError(status: 400 | 403 | 404 | 500, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// O_NOFOLLOW makes the OS refuse to open a symlinked FINAL component (ELOOP),
// atomically — the TOCTOU backstop to the resolver's lstat tail-walk. Falls
// back to 0 (no-op) on platforms lacking it; the lstat-walk still guards there.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** Existing regular file at `abs`? (a symlink here was already realpath'd). */
function statFile(abs: string): fs.Stats | undefined {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
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

    const existing = statFile(resolved.absPath);
    // In-scope path that exists but is NOT a regular file (a dir): refuse
    // rather than EISDIR. Non-existent → this is a create.
    if (fs.existsSync(resolved.absPath) && !existing) return jsonError(403, 'forbidden');

    const oldContent = existing ? fs.readFileSync(resolved.absPath, 'utf-8') : '';
    const willModify = existing !== undefined;
    const willCreate = !willModify;
    const diff = unifiedDiff(oldContent, content, resolved.relPath);

    if (dryRun !== false) {
      return c.json({ diff, willCreate, willModify, pathScope: resolved.scope.kind });
    }

    fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
    // Open with O_NOFOLLOW so a symlinked leaf (e.g. one swapped in after the
    // guard's lstat-walk) is refused by the OS atomically rather than followed.
    let fd: number;
    try {
      fd = fs.openSync(
        resolved.absPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW,
        0o644,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ELOOP') return jsonError(403, 'forbidden');
      throw err;
    }
    try {
      fs.writeFileSync(fd, content, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
    return c.json({
      committed: true,
      created: willCreate,
      modified: willModify,
      path: resolved.relPath,
      pathScope: resolved.scope.kind,
      diff,
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

    if (!statFile(resolved.absPath)) return jsonError(404, 'not found');

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
      const content = fs.readFileSync(fd, 'utf-8');
      return c.json({ path: resolved.relPath, content, pathScope: resolved.scope.kind });
    } finally {
      fs.closeSync(fd);
    }
  });
}
