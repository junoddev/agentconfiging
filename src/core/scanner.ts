/**
 * scanner — fs walker producing a Manifest (SPEC §4/§4.1).
 *
 * This is the ONE core module that touches the filesystem. Everything
 * downstream (detect(), analyze()) runs on the Manifest with zero I/O.
 *
 * Path knowledge tables (KNOWN_FILES, KNOWN_DIRS, ALLOWED_EXTS, SKIP_DIRS)
 * and the caps are lifted verbatim from
 * `../markdowning/cli/src/verticals/agentconfig/scanner.js` (our own project).
 *
 * Guards:
 * - The root itself (project root, or a global dir like ~/.claude) IS
 *   resolved through symlinks once at entry via realpathSync — dotfile
 *   managers commonly symlink these, and the caller explicitly designated
 *   them as in-scope. The scan is then anchored at the real directory.
 * - INSIDE the tree, symlinks are never followed (file or dir) — they
 *   cannot escape the scope.
 * - SKIP_DIRS are pruned from the walk.
 * - Files whose first 8 KiB contain a NUL byte are treated as binary:
 *   size + sha256 are recorded but content is withheld (`truncated: true`).
 * - Content inlining is capped at CAPS.maxFileBytes (64 KiB, from
 *   markdowning); larger files keep size + sha256 but no content.
 *
 * Note: the scanner emits RAW content. Redaction (src/core/redact/) is a
 * separate stage applied downstream before anything leaves the machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Manifest, ManifestFile, ManifestScope } from './manifest.js';

export const KNOWN_FILES: readonly string[] = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.aider.conf.yml',
  '.aiderignore',
  '.continuerules',
  'COPILOT.md',
];

export const KNOWN_DIRS: readonly string[] = [
  '.claude',
  '.cursor',
  '.continue',
  '.gemini',
  '.codex',
  '.opencode',
  '.github/copilot',
  '.aider',
];

export const ALLOWED_EXTS: readonly string[] = [
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.sh',
  '.ts',
  '.js',
  '.py',
  '.mdc',
];

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'deps',
  '_build',
  'dist',
  'build',
  'target',
  '.cache',
  '.next',
  'coverage',
]);

/**
 * Extra prune list for GLOBAL scope only (not from markdowning): runtime
 * state dirs under ~/.claude, ~/.codex, ~/.gemini etc. that hold session
 * history, logs, and caches — not configuration — and can contain thousands
 * of files (which would trip CAPS.maxFiles on any real machine).
 *
 * NOTE: the `plugins` exclusion is a size tradeoff — ~/.claude/plugins holds
 * real config (marketplace clones with skills/commands) and may need
 * revisiting when plugin detection lands.
 */
export const GLOBAL_SKIP_DIRS: ReadonlySet<string> = new Set([
  ...SKIP_DIRS,
  'projects',
  'todos',
  'statsig',
  'shell-snapshots',
  'ide',
  'logs',
  'log',
  'file-history',
  'plugins',
  'sessions',
  'tmp',
]);

export const CAPS = {
  maxFiles: 200,
  maxTotalBytes: 2 * 1024 * 1024,
  maxFileBytes: 64 * 1024,
} as const;

export type ScanErrorCode = 'E_TOO_MANY_FILES' | 'E_TOO_LARGE';

export class ScanError extends Error {
  readonly code: ScanErrorCode;

  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.name = 'ScanError';
    this.code = code;
  }
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function normalizeRel(p: string): string {
  // Always forward-slash, no leading '/'.
  return p.split(path.sep).join('/').replace(/^\/+/, '');
}

function hasAllowedExt(relPath: string): boolean {
  return ALLOWED_EXTS.includes(path.extname(relPath).toLowerCase());
}

function isUnderKnownDir(norm: string): boolean {
  for (const dir of KNOWN_DIRS) {
    if (norm === dir) return true;
    if (norm.startsWith(dir + '/')) return true;
  }
  return false;
}

function isKnownRootFile(norm: string): boolean {
  // Known root files have no '/' in their relative path.
  if (norm.includes('/')) return false;
  return KNOWN_FILES.includes(norm);
}

/** Project-scope include rule: known root file, or under a known dir with an allowed ext. */
function shouldIncludeProjectFile(relPath: string): boolean {
  const norm = normalizeRel(relPath);
  if (isKnownRootFile(norm)) return true;
  if (!isUnderKnownDir(norm)) return false;
  return hasAllowedExt(norm);
}

/** Global-scope include rule: the root IS the config dir, so any allowed ext counts. */
function shouldIncludeGlobalFile(relPath: string): boolean {
  return hasAllowedExt(normalizeRel(relPath));
}

interface WalkEntry {
  absPath: string;
  relPath: string;
}

function walk(
  rootDir: string,
  include: (relPath: string) => boolean,
  skipDirs: ReadonlySet<string>,
): { entries: WalkEntry[]; skipped: number } {
  const out: WalkEntry[] = [];
  let skipped = 0;

  function recur(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM' || code === 'ENOENT') {
        skipped += 1;
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        // Never follow symlinks — they could point out of scope.
        skipped += 1;
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full);

      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) {
          skipped += 1;
          continue;
        }
        recur(full);
      } else if (entry.isFile()) {
        if (include(rel)) {
          out.push({ absPath: full, relPath: normalizeRel(rel) });
        }
      }
    }
  }

  recur(rootDir);
  return { entries: out, skipped };
}

function isProbablyText(buf: Buffer): boolean {
  // Cheap heuristic: reject if NUL byte appears in the first 8KB.
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return false;
  }
  return true;
}

const tooLargeError = () =>
  new ScanError(
    'E_TOO_LARGE',
    `Total agent-config payload exceeds ${CAPS.maxTotalBytes} bytes. Run in a smaller subtree.`,
  );

function buildManifest(
  absRoot: string,
  cwdBasename: string,
  walked: { entries: WalkEntry[]; skipped: number },
  scope: ManifestScope,
): Manifest {
  const { entries } = walked;
  let skipped = walked.skipped;

  if (entries.length > CAPS.maxFiles) {
    throw new ScanError(
      'E_TOO_MANY_FILES',
      `Too many agent-config files: ${entries.length} (limit ${CAPS.maxFiles}). Run in a smaller subtree.`,
    );
  }

  // Deterministic order regardless of readdir order. Plain codepoint
  // compare, NOT localeCompare — locale collation is ICU-dependent and
  // would order the same tree differently across machines.
  entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  let totalBytes = 0;
  const files: ManifestFile[] = [];

  for (const { absPath, relPath } of entries) {
    // Check the total-byte budget from stat BEFORE reading, so a huge file
    // fails the scan loudly instead of being read (or choking readFileSync).
    let statSize: number;
    try {
      statSize = fs.statSync(absPath).size;
    } catch {
      skipped += 1;
      continue;
    }
    if (totalBytes + statSize > CAPS.maxTotalBytes) {
      throw tooLargeError();
    }

    let buf: Buffer;
    try {
      buf = fs.readFileSync(absPath);
    } catch {
      skipped += 1;
      continue;
    }

    const size = buf.length;
    totalBytes += size;
    if (totalBytes > CAPS.maxTotalBytes) {
      // File grew between stat and read.
      throw tooLargeError();
    }

    const sha256 = sha256Hex(buf);

    if (size > CAPS.maxFileBytes || !isProbablyText(buf)) {
      // Over the inlining cap or binary: keep size + hash, withhold content.
      files.push({ path: relPath, size, sha256, truncated: true });
      continue;
    }

    files.push({ path: relPath, size, sha256, content: buf.toString('utf-8') });
  }

  return {
    root: absRoot,
    cwdBasename,
    files,
    stats: { fileCount: files.length, totalBytes, skipped },
    scope,
    localOnly: scope === 'global',
  };
}

/**
 * Scan a project root (repo) and build a project-scope Manifest.
 *
 * A symlinked root is resolved once via realpathSync (the caller designated
 * it as in-scope); `root` is the real path, `cwdBasename` keeps the name the
 * caller pointed at. Throws ScanError (E_TOO_MANY_FILES | E_TOO_LARGE) when
 * caps are exceeded.
 */
export function scanProject(rootDir: string): Manifest {
  const logicalRoot = path.resolve(rootDir);
  const absRoot = fs.realpathSync(logicalRoot);
  return buildManifest(
    absRoot,
    path.basename(logicalRoot),
    walk(absRoot, shouldIncludeProjectFile, SKIP_DIRS),
    'project',
  );
}

/**
 * Scan global-scope agent config under a home directory: each KNOWN_DIRS
 * entry that exists under `homeDir` (~/.claude, ~/.codex, ...) becomes one
 * Manifest rooted at that dir, flagged `scope: 'global', localOnly: true`.
 *
 * `homeDir` is always passed in explicitly (inject os.homedir() at the call
 * site) so tests can use a fake home. Missing dirs are skipped silently.
 * A symlinked config dir (dotfile managers do this) is intentionally
 * resolved via realpathSync; `root` is the real path while `cwdBasename`
 * keeps the well-known name (e.g. '.claude').
 */
export function scanGlobal(homeDir: string): Manifest[] {
  const absHome = path.resolve(homeDir);
  const manifests: Manifest[] = [];

  for (const dir of KNOWN_DIRS) {
    const logicalRoot = path.join(absHome, dir);
    let absRoot: string;
    try {
      absRoot = fs.realpathSync(logicalRoot);
      if (!fs.statSync(absRoot).isDirectory()) continue;
    } catch {
      continue;
    }

    manifests.push(
      buildManifest(
        absRoot,
        path.basename(logicalRoot),
        walk(absRoot, shouldIncludeGlobalFile, GLOBAL_SKIP_DIRS),
        'global',
      ),
    );
  }

  return manifests;
}
