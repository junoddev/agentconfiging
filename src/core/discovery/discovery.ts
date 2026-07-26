/**
 * discovery — recursive agent-project walker (SPEC §4.2).
 *
 * Given a directory, find agent-configured projects beneath it. This is a
 * marker-file walk driven by the detector match triggers (markers.ts): it
 * records only `{ root, markers, runtimes }` per hit — the full engine run
 * (scan → detect → analyze) happens later, when an instance is opened.
 *
 * Cheapness contract: stat/readdir only, never a file read — directory
 * entry NAMES are enough to match every marker (plus one shallow readdir
 * of `.github` for the Copilot triggers that live one level down).
 *
 * Guards (mirroring src/core/scanner.ts semantics):
 * - The walk root is resolved through symlinks ONCE at entry via
 *   realpathSync — the caller explicitly designated it as in-scope.
 * - INSIDE the tree, symlinks are never followed (file or dir), and a
 *   symlink whose name matches a marker does not count as one.
 * - SKIP_DIRS are pruned from the walk.
 * - Depth is bounded (default 6 levels below the root) and the total
 *   directory count is capped (default 10,000; hitting it sets
 *   `stats.truncated`) — a scan of $HOME terminates fast, never hangs.
 *
 * Nesting: a hit's subdirectories keep being walked — nested repos are
 * real, and a nested hit is reported as its own entry. No parent/child
 * dedup logic; the relation is visible via path prefix on `root`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SKIP_DIRS } from '../scanner.js';
import {
  COPILOT_RUNTIME,
  DIR_MARKERS,
  FILE_MARKERS,
  GITHUB_COPILOT_DIR,
  GITHUB_COPILOT_FILE,
  GITHUB_DIR,
} from './markers.js';

/** Levels below the root the walk will enter (0 = root only). */
export const DEFAULT_MAX_DEPTH = 6;

/** Total directories readdir'd before the walk stops with `truncated`. */
export const DEFAULT_MAX_DIRS = 10_000;

export type DiscoveryErrorCode = 'E_ROOT_NOT_FOUND' | 'E_ROOT_NOT_DIR';

/** Typed root-validation failure, mirroring the ScanError precedent in scanner.ts. */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

export interface DiscoverOptions {
  /** Override DEFAULT_MAX_DEPTH. */
  maxDepth?: number;
  /** Override DEFAULT_MAX_DIRS. */
  maxDirs?: number;
}

export interface DiscoveryHit {
  /** Absolute path of the directory that carries markers. */
  root: string;
  /** Marker entry names found at this root (e.g. 'CLAUDE.md', '.claude'), codepoint-sorted. */
  markers: string[];
  /** Runtime ids the markers attribute to (detector ids), unique + codepoint-sorted. */
  runtimes: string[];
}

export interface DiscoveryStats {
  /** Directories readdir'd (root, recursed subdirs, and .github probes). */
  dirsVisited: number;
  /** True when the maxDirs cap stopped the walk before it finished. */
  truncated: boolean;
  /** Entries passed over: symlinks, SKIP_DIRS prunes, unreadable dirs, depth-pruned dirs. */
  skipped: number;
}

export interface DiscoveryResult {
  hits: DiscoveryHit[];
  stats: DiscoveryStats;
}

function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Walk `rootDir` and report every directory beneath it (root included)
 * that carries agent-runtime markers. Deterministic: children are
 * traversed in codepoint name order, so hit order — and which dirs a
 * maxDirs truncation drops — is stable across machines.
 *
 * Throws DiscoveryError (E_ROOT_NOT_FOUND | E_ROOT_NOT_DIR) when `rootDir`
 * does not exist or is not a directory.
 */
export function discoverProjects(rootDir: string, opts: DiscoverOptions = {}): DiscoveryResult {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxDirs = opts.maxDirs ?? DEFAULT_MAX_DIRS;

  const logicalRoot = path.resolve(rootDir);
  let absRoot: string;
  try {
    absRoot = fs.realpathSync(logicalRoot);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new DiscoveryError(
        'E_ROOT_NOT_FOUND',
        `discoverProjects: root does not exist: ${logicalRoot}`,
      );
    }
    throw err;
  }
  if (!fs.statSync(absRoot).isDirectory()) {
    throw new DiscoveryError('E_ROOT_NOT_DIR', `discoverProjects: not a directory: ${absRoot}`);
  }

  const hits: DiscoveryHit[] = [];
  const stats: DiscoveryStats = { dirsVisited: 0, truncated: false, skipped: 0 };

  /** One readdir, sorted for determinism; undefined when unreadable or capped. */
  function listDir(dir: string): fs.Dirent[] | undefined {
    if (stats.dirsVisited >= maxDirs) {
      stats.truncated = true;
      return undefined;
    }
    stats.dirsVisited += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'ENOENT') {
        stats.skipped += 1;
        return undefined;
      }
      throw err;
    }
    return entries.sort((a, b) => codepointCompare(a.name, b.name));
  }

  /** Shallow probe of a `.github` dir for the two Copilot triggers. Names only. */
  function probeGithub(ghDir: string, markers: string[], runtimes: Set<string>): void {
    const entries = listDir(ghDir);
    if (entries === undefined) return;
    for (const entry of entries) {
      if (entry.isFile() && entry.name === GITHUB_COPILOT_FILE) {
        markers.push(`${GITHUB_DIR}/${GITHUB_COPILOT_FILE}`);
        runtimes.add(COPILOT_RUNTIME);
      } else if (entry.isDirectory() && entry.name === GITHUB_COPILOT_DIR) {
        markers.push(`${GITHUB_DIR}/${GITHUB_COPILOT_DIR}`);
        runtimes.add(COPILOT_RUNTIME);
      }
    }
  }

  function walk(dir: string, depth: number): void {
    const entries = listDir(dir);
    if (entries === undefined) return;

    const markers: string[] = [];
    const runtimes = new Set<string>();
    const subdirs: string[] = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        // Never followed, never a marker — a symlink cannot escape scope.
        stats.skipped += 1;
        continue;
      }

      if (entry.isFile()) {
        const runtime = FILE_MARKERS.get(entry.name);
        if (runtime !== undefined) {
          markers.push(entry.name);
          runtimes.add(runtime);
        }
        continue;
      }

      if (!entry.isDirectory()) continue;

      const runtime = DIR_MARKERS.get(entry.name);
      if (runtime !== undefined) {
        // Marker dir: record it, never recurse — its contents are runtime
        // config, not nested projects.
        markers.push(entry.name);
        runtimes.add(runtime);
        continue;
      }
      if (entry.name === GITHUB_DIR) {
        // Copilot triggers live inside .github; probe shallowly and do not
        // recurse — projects do not nest under .github.
        probeGithub(path.join(dir, entry.name), markers, runtimes);
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        stats.skipped += 1;
        continue;
      }
      subdirs.push(entry.name);
    }

    if (markers.length > 0) {
      hits.push({
        root: dir,
        markers: markers.sort(codepointCompare),
        runtimes: [...runtimes].sort(codepointCompare),
      });
    }

    if (depth >= maxDepth) {
      stats.skipped += subdirs.length;
      return;
    }
    for (const name of subdirs) {
      if (stats.truncated) return;
      walk(path.join(dir, name), depth + 1);
    }
  }

  walk(absRoot, 0);
  return { hits, stats };
}
