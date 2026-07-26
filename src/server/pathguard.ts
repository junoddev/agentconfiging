/**
 * pathguard — the canonical-path traversal guard for the WRITE API
 * (SPEC §4.3, bead agentconfig-gxo.3). This is the crux of the write surface:
 * every mutating (and the single reading) endpoint routes its `path` through
 * `resolveWriteTarget` before touching disk.
 *
 * ALGORITHM (`resolveWriteTarget(requestedPath, scopes)`):
 *  1. INPUT DISCIPLINE (→ 400 'bad request', never a disk touch):
 *     - must be a non-empty string, <= MAX_PATH_LEN;
 *     - no NUL byte (`\0`);
 *     - no backslash separators (Windows separator / traversal trick);
 *     - no percent-encoded dot/slash/NUL (`%2e`, `%2f`, `%5c`, `%00`) — this
 *       API takes a literal path, so encoded traversal is always hostile;
 *     - no `..` path segment (traversal);
 *     - no segment longer than MAX_SEGMENT_LEN; no segment with a trailing
 *       `.`/space or leading space (Windows strips these → filename aliasing).
 *  2. ANCHOR: relative paths resolve against the PROJECT scope root; absolute
 *     paths are taken as-is (and must fall inside some scope in step 4).
 *  3. CANONICALIZE (realpath semantics, file may not exist yet): realpath the
 *     nearest EXISTING ancestor of the target. Any symlink in that existing
 *     chain is resolved — a symlink that escapes scope resolves to an
 *     out-of-scope real path and is rejected in step 4.
 *  4. SCOPE CHECK: the realpath'd existing ancestor AND the realpath'd target
 *     must sit within a realpath'd scope root, tested with segment-aware
 *     containment (`/foo` never matches `/foobar`) — NOT string prefix.
 *  5. TAIL SYMLINK WALK (the dangling-symlink defense): `realpathSync` throws
 *     ENOENT on a DANGLING symlink (target absent), so step 3 misfiles a
 *     dangling-symlink leaf/segment as a to-be-created tail — it is never
 *     resolved and never scope-checked, and a naive write would follow it OUT
 *     of scope (e.g. `.claude/hook.md` → `<project>/.git/hooks/pre-commit`).
 *     So `lstat` (which does NOT follow) every tail segment including the leaf;
 *     ANY symlink → 403. (The caller ALSO opens the leaf with O_NOFOLLOW as an
 *     atomic TOCTOU backstop.)
 *  6. ALLOWLIST: the scope-relative path must be a KNOWN config path shape
 *     (src/core/scanner.ts `isWritableConfigPath`) — an in-scope but
 *     unrecognized path (e.g. `random/evil.sh`) is refused.
 *
 * NO EXISTENCE ORACLE: every scope/allowlist failure returns an identical 403
 * with no path echoed, so an out-of-scope path that exists is indistinguishable
 * from one that does not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isWritableConfigPath } from '../core/scanner.js';

export interface WriteScope {
  /** Canonical (realpath'd) absolute scope root. */
  root: string;
  kind: 'project' | 'global';
}

export interface ResolvedTarget {
  ok: true;
  /** Absolute path to read/write: realpath'd existing ancestor + new tail. */
  absPath: string;
  /** Scope-relative, forward-slash path (feeds the allowlist and the diff). */
  relPath: string;
  scope: WriteScope;
}

export interface RejectedTarget {
  ok: false;
  /** 400 = malformed input; 403 = out-of-scope / not-a-known-config-path. */
  status: 400 | 403;
}

export type Resolution = ResolvedTarget | RejectedTarget;

const MAX_PATH_LEN = 4096;
const MAX_SEGMENT_LEN = 255;

/**
 * Additive extension to the core write-allowlist (scanner.isWritableConfigPath),
 * kept here in src/server rather than src/core (which is import-only from the
 * server): project-root config files that carry MACHINE FIXES (SPEC §4.1) but
 * are not part of the ENGINE's scan-collection set. `.gitignore` is the
 * settings-local-committed fix target — a well-known, safe, project-root file
 * with no allowed extension, so the scanner never collects it, yet applying its
 * fix must write it. Project scope only, root only; every other guard (scope
 * containment, traversal, symlink/O_NOFOLLOW) still applies unchanged.
 */
const ADDITIONAL_WRITABLE_ROOT_FILES: ReadonlySet<string> = new Set(['.gitignore']);

/**
 * The write allowlist the guard enforces: the core engine's include rules PLUS
 * the server-side additions above. A fix edit path is checked here identically
 * to a user write — an analyzer-emitted fix is no more trusted than a user edit.
 */
function isWritableTarget(rel: string, kind: 'project' | 'global'): boolean {
  if (isWritableConfigPath(rel, kind)) return true;
  return kind === 'project' && !rel.includes('/') && ADDITIONAL_WRITABLE_ROOT_FILES.has(rel);
}

const bad = (status: 400 | 403): RejectedTarget => ({ ok: false, status });

/** Segment-aware containment: `child` is `parent` or strictly nested under it.
 *  Exported as the single shared containment primitive (storage.ts reuses it)
 *  so the two call sites can't drift. */
export function isWithin(parent: string, child: string): boolean {
  if (parent === child) return true;
  const rel = path.relative(parent, child);
  return (
    rel.length > 0 && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
  );
}

/**
 * Realpath the nearest EXISTING ancestor of `abs`; return it plus the ordered
 * list of non-existent tail segments (outermost-first). `undefined` only if the
 * walk reaches the filesystem root without finding anything (never in practice).
 */
function realpathAncestor(abs: string): { real: string; tail: string[] } | undefined {
  let current = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return { real: fs.realpathSync(current), tail: tail.slice().reverse() };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * True if any tail segment under `realAncestor` is a symlink (dangling or not).
 * lstat does NOT follow, so it detects the dangling links realpathSync missed.
 * A genuinely absent segment (ENOENT) is fine — there is nothing to follow.
 */
function tailHasSymlink(realAncestor: string, tail: string[]): boolean {
  let cursor = realAncestor;
  for (const seg of tail) {
    cursor = path.join(cursor, seg);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return true;
    } catch {
      // ENOENT: genuinely not there yet — no symlink to follow.
    }
  }
  return false;
}

function inputIsClean(p: string): boolean {
  if (p.length === 0 || p.length > MAX_PATH_LEN) return false;
  if (p.includes('\0')) return false;
  if (p.includes('\\')) return false;
  if (/%2e|%2f|%5c|%00/i.test(p)) return false;
  for (const seg of p.split('/')) {
    if (seg === '..') return false;
    if (seg.length > MAX_SEGMENT_LEN) return false;
    if (seg.length > 0 && (seg.endsWith('.') || seg.endsWith(' ') || seg.startsWith(' '))) {
      return false;
    }
  }
  return true;
}

export function resolveWriteTarget(requestedPath: unknown, scopes: WriteScope[]): Resolution {
  if (typeof requestedPath !== 'string') return bad(400);
  if (!inputIsClean(requestedPath)) return bad(400);

  const projectScope = scopes.find((s) => s.kind === 'project');
  const abs = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : projectScope
      ? path.resolve(projectScope.root, requestedPath)
      : undefined;
  if (abs === undefined) return bad(403);

  const anc = realpathAncestor(abs);
  if (!anc) return bad(403);
  const realTarget = anc.tail.length === 0 ? anc.real : path.join(anc.real, ...anc.tail);

  for (const scope of scopes) {
    // The realpath'd existing chain must not have escaped; the (possibly
    // not-yet-existent) target must also resolve inside the same scope.
    if (!isWithin(scope.root, anc.real)) continue;
    if (!isWithin(scope.root, realTarget)) continue;
    const rel = path.relative(scope.root, realTarget).split(path.sep).join('/');
    if (rel === '' || rel.startsWith('..')) continue;
    // Dangling-symlink defense: lstat (never follows) every tail segment —
    // including the leaf — that realpathAncestor treated as "to be created". A
    // DANGLING symlink threw ENOENT from realpathSync and so landed in the
    // tail; lstat still sees it. ANY symlink here would be followed OUT of
    // scope on the subsequent open, so refuse.
    if (tailHasSymlink(anc.real, anc.tail)) return bad(403);
    if (!isWritableTarget(rel, scope.kind)) return bad(403);
    return { ok: true, absPath: realTarget, relPath: rel, scope };
  }
  return bad(403);
}
