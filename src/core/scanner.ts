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

/**
 * Documented additions to the verbatim KNOWN_FILES table (bead
 * agentconfig-np8.12; same pattern as GLOBAL_SKIP_DIRS below: the ported
 * tables stay byte-identical to markdowning, extensions live beside them
 * and are merged at match time).
 *
 * Each entry is an exact project-relative path that a detector match
 * trigger, discovery marker, or parser reads — but that the ported include
 * rules never collect, so the artifact could be detected from fixture
 * manifests yet never reach parsers/analyzers on a real scan. Upstream
 * markdowning lacked them because its scanner predated the MCP pipeline
 * and only mirrored the root files its own detectors used:
 *
 * - '.mcp.json'            — root MCP server config; parsed by report.ts
 *                            (parseMcpJson) and required for the
 *                            mcp-command-not-on-path analyzer to fire.
 * - 'codex.toml'           — codex detector match trigger and discovery
 *                            FILE_MARKERS row.
 * - 'opencode.json'        — opencode detector match trigger, FILE_MARKERS
 *                            row, and source of its providers/model extras.
 * - '.github/copilot-instructions.md'
 *                          — copilot detector match trigger, discovery
 *                            .github probe target, and report.ts
 *                            GUIDE_PATHS entry. NOT covered by KNOWN_DIRS:
 *                            the '.github/copilot' prefix only matches
 *                            '.github/copilot/...', not this sibling file.
 *
 * Matched as exact normalized paths (not names), so nested lookalikes like
 * 'sub/.mcp.json' stay excluded, consistent with KNOWN_FILES root-only
 * semantics.
 */
export const ADDITIONAL_KNOWN_FILES: ReadonlySet<string> = new Set([
  '.mcp.json',
  'codex.toml',
  'opencode.json',
  '.github/copilot-instructions.md',
]);

/**
 * Documented addition to the verbatim include rules (bead agentconfig-np8.13;
 * same additive pattern as ADDITIONAL_KNOWN_FILES above — the ported tables
 * stay byte-identical, extensions live beside them and merge at match time).
 *
 * The copilot detector's extract() enriches from
 * '.github/instructions/*.instructions.md' — the newer path-scoped Copilot
 * format (canonical copilot-basic fixture: '.github/instructions/api.instructions.md').
 * Unlike ADDITIONAL_KNOWN_FILES this is a GLOB, not an exact path, so it cannot
 * be an exact-set entry. It is also NOT covered by KNOWN_DIRS: '.github/copilot'
 * only matches '.github/copilot/...', not this sibling '.github/instructions/'
 * subtree. Without this rule copilot still detects (its match triggers are
 * collected), but the scoped instruction files' content never reaches
 * parsers/analyzers on a real scan.
 *
 * Scoped narrowly to avoid over-collecting the rest of '.github/': only paths
 * directly under '.github/instructions/' ending in '.instructions.md' match.
 * '.github/workflows/*.yml', '.github/ISSUE_TEMPLATE/*', and arbitrary
 * '.github/foo.md' stay excluded.
 */
const SCOPED_INSTRUCTIONS_PREFIX = '.github/instructions/';
const SCOPED_INSTRUCTIONS_SUFFIX = '.instructions.md';

function isAdditionalScopedInstruction(norm: string): boolean {
  return norm.startsWith(SCOPED_INSTRUCTIONS_PREFIX) && norm.endsWith(SCOPED_INSTRUCTIONS_SUFFIX);
}

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

/**
 * `maxDirs` / `maxDepth` added for bead agentconfig-gxo.6 (adversarial review):
 * gxo.6 broadened the report target from cwd-only to any user-designated,
 * token-named directory, so `add({path:"/"}) + report` could otherwise walk
 * essentially the whole disk synchronously (blocking the event loop) before
 * any file/byte cap — which only checks AFTER the full walk — ever tripped.
 * These bound the WALK itself, mirroring the discovery walker (discovery.ts,
 * which caps at 10000 dirs / depth 6). `maxDepth` is generous: real config
 * lives shallow (.claude/agents/x.md is depth 2, .cursor/rules/*.mdc depth 2).
 * The verbatim markdowning caps (maxFiles/maxTotalBytes/maxFileBytes) are
 * untouched.
 */
export const CAPS = {
  maxFiles: 200,
  maxTotalBytes: 2 * 1024 * 1024,
  maxFileBytes: 64 * 1024,
  maxDirs: 10000,
  maxDepth: 16,
} as const;

export type ScanErrorCode = 'E_TOO_MANY_FILES' | 'E_TOO_LARGE' | 'E_TOO_MANY_DIRS';

/** Per-scan overrides for the walk bounds (tests inject small caps; prod uses CAPS). */
export interface ScanOptions {
  /** Max directories readdir'd before failing fast (default CAPS.maxDirs). */
  maxDirs?: number;
  /** Max directory depth descended into; deeper subtrees are pruned (default CAPS.maxDepth). */
  maxDepth?: number;
}

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

/**
 * Project-scope include rule: known root file, documented additional known
 * file (agentconfig-np8.12), documented scoped-instruction glob
 * (agentconfig-np8.13), or under a known dir with an allowed ext.
 */
function shouldIncludeProjectFile(relPath: string): boolean {
  const norm = normalizeRel(relPath);
  if (isKnownRootFile(norm)) return true;
  if (ADDITIONAL_KNOWN_FILES.has(norm)) return true;
  if (isAdditionalScopedInstruction(norm)) return true;
  if (!isUnderKnownDir(norm)) return false;
  return hasAllowedExt(norm);
}

/** Global-scope include rule: the root IS the config dir, so any allowed ext counts. */
function shouldIncludeGlobalFile(relPath: string): boolean {
  return hasAllowedExt(normalizeRel(relPath));
}

/**
 * Public WRITE-allowlist predicate (bead agentconfig-gxo.3): is `relPath` a
 * KNOWN, writable config path within a scope of the given kind? Delegates to
 * the exact same include rules the scanner walks with, so the write allowlist
 * can never drift from what the engine recognizes — a write to an in-scope but
 * unrecognized path (e.g. `random/evil.sh` under the project root) is refused.
 *
 * `relPath` is scope-relative; either separator is accepted (normalized here).
 * Project scope allows: KNOWN_FILES at the root, ADDITIONAL_KNOWN_FILES, the
 * scoped-instruction glob, and ALLOWED_EXTS files under a KNOWN_DIRS subtree.
 * Global scope (root already an agent config dir like ~/.claude) allows any
 * ALLOWED_EXTS file.
 */
export function isWritableConfigPath(relPath: string, scope: 'project' | 'global'): boolean {
  return scope === 'global' ? shouldIncludeGlobalFile(relPath) : shouldIncludeProjectFile(relPath);
}

interface WalkEntry {
  absPath: string;
  relPath: string;
}

function walk(
  rootDir: string,
  include: (relPath: string) => boolean,
  skipDirs: ReadonlySet<string>,
  limits: { maxDirs: number; maxDepth: number },
): { entries: WalkEntry[]; skipped: number } {
  const out: WalkEntry[] = [];
  let skipped = 0;
  let dirsVisited = 0;

  function recur(dir: string, depth: number): void {
    // Dir-visit cap (bead agentconfig-gxo.6 review): fail fast BEFORE the
    // next readdir, so a system-root-style scan raises a typed ScanError
    // rather than storming the disk and blocking the event loop. Consistent
    // with the E_TOO_MANY_FILES / E_TOO_LARGE fail-loud pattern.
    if (dirsVisited >= limits.maxDirs) {
      throw new ScanError(
        'E_TOO_MANY_DIRS',
        `Scan visited too many directories (limit ${limits.maxDirs}). Run in a smaller subtree.`,
      );
    }
    dirsVisited += 1;

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
        // Depth cap (bead agentconfig-gxo.6 review): real config is shallow,
        // so prune subtrees deeper than maxDepth rather than throw — a deep
        // repo still scans its config, it just doesn't descend forever.
        if (depth + 1 > limits.maxDepth) {
          skipped += 1;
          continue;
        }
        recur(full, depth + 1);
      } else if (entry.isFile()) {
        if (include(rel)) {
          out.push({ absPath: full, relPath: normalizeRel(rel) });
        }
      }
    }
  }

  recur(rootDir, 0);
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
 * caller pointed at. Throws ScanError (E_TOO_MANY_FILES | E_TOO_LARGE |
 * E_TOO_MANY_DIRS) when caps are exceeded. `opts` overrides the walk bounds
 * (agentconfig-gxo.6); production omits it and uses CAPS.
 */
export function scanProject(rootDir: string, opts: ScanOptions = {}): Manifest {
  const logicalRoot = path.resolve(rootDir);
  const absRoot = fs.realpathSync(logicalRoot);
  const limits = {
    maxDirs: opts.maxDirs ?? CAPS.maxDirs,
    maxDepth: opts.maxDepth ?? CAPS.maxDepth,
  };
  return buildManifest(
    absRoot,
    path.basename(logicalRoot),
    walk(absRoot, shouldIncludeProjectFile, SKIP_DIRS, limits),
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
        walk(absRoot, shouldIncludeGlobalFile, GLOBAL_SKIP_DIRS, {
          maxDirs: CAPS.maxDirs,
          maxDepth: CAPS.maxDepth,
        }),
        'global',
      ),
    );
  }

  return manifests;
}
