/**
 * storage — the disk-usage + safe-cleanup API (SPEC §5 row 2, bead
 * agentconfig-wmc.2). Registered into the hardened Hono app (src/server/app.ts)
 * under `/api`, so both routes INHERIT the committed gates: Host allowlist,
 * bearer token, and — for the state-changing POST — the same-origin Origin/CSRF
 * check. This module adds no gate of its own; it adds the allowlist + on-disk
 * discipline that makes a CLEANUP safe once a request is authorized.
 *
 * ENDPOINTS:
 *  - GET  /api/storage?instance=  → { instance, homes[] }
 *      A per-instance disk-usage breakdown of the agent config directories: the
 *      global agent homes (~/.claude, ~/.codex, …) and the project's own agent
 *      dirs (<root>/.claude, …). Each home lists its immediate subdirectories
 *      with a recursive byte/file total and a `safeToClean` flag. Read-only.
 *  - POST /api/storage/cleanup   { instance?, home, name }  → { cleaned, … }
 *      TRASHES (never hard-deletes — reuses trashFile) one safe-to-clean subdir.
 *
 * SECURITY MODEL (the crux — a cleanup must never delete config or escape scope):
 *  1. ALLOWLIST BY NAME: `name` MUST be one of {@link SAFE_CLEAN_SUBDIRS} — a
 *     fixed set of ephemeral runtime-state dirs (logs, caches, shell snapshots,
 *     temp). These literals contain no `/` or `..`, so the join below can never
 *     traverse. Config dirs (agents/, commands/, rules/, skills/, settings*) and
 *     user history (sessions/, todos/, projects/, file-history/) are NOT in the
 *     set and can never be cleaned. Checked BEFORE any fs touch.
 *  2. ALLOWLIST BY HOME: `home` is a server-issued KEY (`global:.claude`,
 *     `project:.claude`). The set of valid keys → roots is RECOMPUTED server-side
 *     per request from the registry + the configured global scopes — never taken
 *     from client-supplied paths. An unknown key is refused. So a caller cannot
 *     point cleanup at an arbitrary directory: neither the home nor the subdir
 *     name is a free path.
 *  3. SYMLINK + CONTAINMENT (same discipline as the write path guard): lstat the
 *     candidate (never follows) — a symlinked subdir is refused rather than
 *     followed out of the agent home; realpath must still land inside the home
 *     root (segment-aware containment, `/foo` never matches `/foobar`).
 *  4. RECOVERABLE: the dir is MOVED to trash (trashFile), never unlinked.
 *
 * ERROR DISCIPLINE (constant JSON bodies, no path echo, no oracle):
 *  - 400 'bad request'  malformed body / missing home|name
 *  - 403 'forbidden'    name/home not allowlisted, symlink, or escapes the home
 *  - 404 'not found'    unknown instance, or an allowlisted subdir that is absent
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import { KNOWN_DIRS } from '../core/index.js';
import { isWithin, type WriteScope } from './pathguard.js';
import { jsonError } from './http.js';
import type { InstanceRegistry } from './registry.js';
import { trashFile } from './trash.js';

export interface StorageRoutesConfig {
  /** The write scopes — the `global` entries are the agent homes to break down. */
  scopes: WriteScope[];
  registry: InstanceRegistry;
  /** Where cleaned dirs are moved (never hard-unlinked). */
  trashDir: string;
}

/**
 * The ONLY subdirectories a cleanup may trash: ephemeral runtime state agent
 * homes accumulate — logs, analytics caches, shell snapshots, IDE lockfiles,
 * temp. NEVER configuration (settings*, agents/, commands/, rules/, skills/,
 * hooks/) and NEVER user history a user might want back (sessions/, todos/,
 * projects/, file-history/). Cleaning any of these only frees disk.
 */
const SAFE_CLEAN_SUBDIRS: ReadonlySet<string> = new Set([
  'logs',
  'log',
  'shell-snapshots',
  'statsig',
  'ide',
  'tmp',
]);

/** Bound the usage walk so a pathological tree cannot block the event loop. */
const MAX_WALK_ENTRIES = 50_000;

async function readJsonBody(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await req.json()) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

interface Usage {
  bytes: number;
  files: number;
  truncated: boolean;
}

/**
 * Recursive byte/file total for `abs`, iterative + bounded. Symlinks are never
 * followed (they could point out of the agent home and would double-count or
 * escape); read/stat errors on individual entries are skipped, not fatal.
 */
function dirUsage(abs: string): Usage {
  let bytes = 0;
  let files = 0;
  let visited = 0;
  let truncated = false;
  const stack: string[] = [abs];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_WALK_ENTRIES) {
        truncated = true;
        return { bytes, files, truncated };
      }
      if (entry.isSymbolicLink()) continue; // never follow
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size;
          files += 1;
        } catch {
          // vanished / unreadable — skip.
        }
      }
    }
  }
  return { bytes, files, truncated };
}

interface HomeRoot {
  root: string;
  scope: 'project' | 'global';
}

/**
 * Deterministically map a server-issued home KEY → its realpath'd root for this
 * instance. Recomputed per request from trusted inputs only (the configured
 * global scopes + the registry-resolved project root) — NEVER from a
 * client-supplied path. GET builds its breakdown from this; cleanup validates
 * its `home` against it. Keys: `global:<basename>`, `project:<known-dir>`.
 */
function homeRoots(instanceRoot: string, globalScopes: WriteScope[]): Map<string, HomeRoot> {
  const map = new Map<string, HomeRoot>();
  for (const scope of globalScopes) {
    map.set(`global:${path.basename(scope.root)}`, { root: scope.root, scope: 'global' });
  }
  for (const dir of KNOWN_DIRS) {
    const candidate = path.join(instanceRoot, dir);
    try {
      const real = fs.realpathSync(candidate);
      if (fs.statSync(real).isDirectory()) {
        map.set(`project:${dir}`, { root: real, scope: 'project' });
      }
    } catch {
      // Not present under this instance root.
    }
  }
  return map;
}

interface HomeEntry {
  name: string;
  bytes: number;
  files: number;
  safeToClean: boolean;
}

interface HomeBreakdown {
  key: string;
  scope: 'project' | 'global';
  root: string;
  totalBytes: number;
  entries: HomeEntry[];
}

function breakdownFor(root: string): { totalBytes: number; entries: HomeEntry[] } {
  const entries: HomeEntry[] = [];
  let total = 0;
  let subdirs: fs.Dirent[];
  try {
    subdirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { totalBytes: 0, entries: [] };
  }
  for (const entry of subdirs) {
    // isDirectory() is false for a symlink-to-dir, so this already skips
    // symlinked subdirs — they are never sized and never offered for cleanup.
    if (!entry.isDirectory()) continue;
    const usage = dirUsage(path.join(root, entry.name));
    total += usage.bytes;
    entries.push({
      name: entry.name,
      bytes: usage.bytes,
      files: usage.files,
      safeToClean: SAFE_CLEAN_SUBDIRS.has(entry.name),
    });
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  return { totalBytes: total, entries };
}

export function registerStorageRoutes(app: Hono, config: StorageRoutesConfig): void {
  const { registry, trashDir } = config;
  const globalScopes = config.scopes.filter((s) => s.kind === 'global');

  app.get('/api/storage', (c: Context) => {
    const sel = new URL(c.req.url).searchParams.get('instance') ?? undefined;
    // Resolve ONLY against registered instances (see registry.resolve) — never a
    // scan of an arbitrary path. Unknown selector → 404.
    const instance = registry.resolve(sel);
    if (!instance) return jsonError(404, 'not found');

    try {
      const homes: HomeBreakdown[] = [];
      for (const [key, home] of homeRoots(instance.root, globalScopes)) {
        const { totalBytes, entries } = breakdownFor(home.root);
        homes.push({ key, scope: home.scope, root: home.root, totalBytes, entries });
      }
      return c.json({ instance: instance.id, homes });
    } catch (err) {
      console.error(`agentconfiging server: storage failed: ${String(err)}`);
      return jsonError(500, 'storage failed');
    }
  });

  app.post('/api/storage/cleanup', async (c: Context) => {
    const body = await readJsonBody(c.req.raw);
    if (!body) return jsonError(400, 'bad request');

    const { instance: sel, home, name } = body;
    if (typeof home !== 'string' || typeof name !== 'string') return jsonError(400, 'bad request');
    if (sel !== undefined && typeof sel !== 'string') return jsonError(400, 'bad request');

    const instance = registry.resolve(sel ?? undefined);
    if (!instance) return jsonError(404, 'not found');

    // (1) ALLOWLIST BY NAME — checked before any fs touch. An unknown name never
    // reaches disk. The literal set contains no `/`/`..`, so join can't traverse.
    if (!SAFE_CLEAN_SUBDIRS.has(name)) return jsonError(403, 'forbidden');

    // (2) ALLOWLIST BY HOME — the key must map to a known agent-home root,
    // recomputed here from trusted inputs (never a client path).
    const target = homeRoots(instance.root, globalScopes).get(home);
    if (!target) return jsonError(403, 'forbidden');

    const candidate = path.join(target.root, name);

    // (3) SYMLINK + CONTAINMENT — lstat never follows: a symlinked subdir is
    // refused rather than followed out of the home; realpath must land inside.
    let st: fs.Stats;
    try {
      st = fs.lstatSync(candidate);
    } catch {
      return jsonError(404, 'not found'); // in-scope absence is not secret.
    }
    if (st.isSymbolicLink() || !st.isDirectory()) return jsonError(403, 'forbidden');
    let real: string;
    try {
      real = fs.realpathSync(candidate);
    } catch {
      return jsonError(404, 'not found');
    }
    if (!isWithin(target.root, real)) return jsonError(403, 'forbidden');

    // (4) RECOVERABLE — move to trash, never unlink.
    try {
      const usage = dirUsage(real);
      const result = trashFile(real, name, trashDir);
      return c.json({
        cleaned: true,
        home,
        name,
        bytes: usage.bytes,
        files: usage.files,
        trashedTo: result.trashedTo,
      });
    } catch (err) {
      console.error(`agentconfiging server: cleanup failed: ${String(err)}`);
      return jsonError(500, 'cleanup failed');
    }
  });
}
