/**
 * Manifest shape per SPEC §4.1: `{ root, cwdBasename, files: [{path, size, sha256, content?}], stats }`.
 *
 * The checked-in fixture corpus (fixtures/manifests/*.json) is the canonical
 * form of this shape — the types here MUST stay assignable from those JSON
 * files. Fixtures never carry `scope`/`localOnly`, so both are optional;
 * the scanner always sets them (global scope is local-read/write only and
 * must never leave the machine, hence `localOnly: true`).
 *
 * Pure data + a pure runtime validator — no I/O in this module.
 */

export type ManifestScope = 'project' | 'global';

export interface ManifestFile {
  /** Path relative to `root`, always forward-slash separated. */
  path: string;
  /** Size in bytes on disk. */
  size: number;
  /** sha256 hex digest of the file bytes (always present, even when content is omitted). */
  sha256: string;
  /** UTF-8 file content. Omitted for binary files and files over the inlining cap. */
  content?: string;
  /** True when `content` was withheld (binary or over the size cap). */
  truncated?: boolean;
}

export interface ManifestStats {
  fileCount: number;
  totalBytes: number;
  /** Entries skipped during the scan: symlinks, pruned dirs, and files that could not be stat'd or read. */
  skipped?: number;
}

export interface Manifest {
  /** Absolute path of the scanned root. */
  root: string;
  cwdBasename: string;
  files: ManifestFile[];
  stats: ManifestStats;
  /** 'project' (repo) or 'global' (~/.claude, ~/.codex, ...). Absent in fixtures. */
  scope?: ManifestScope;
  /** True for global scope: data must never leave the machine. */
  localOnly?: boolean;
}

function fail(path: string, expected: string): never {
  throw new Error(`Invalid manifest: ${path} — expected ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'string');
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'finite number');
  return value;
}

function parseFile(value: unknown, path: string): ManifestFile {
  if (!isRecord(value)) fail(path, 'object');
  const file: ManifestFile = {
    path: requireString(value['path'], `${path}.path`),
    size: requireNumber(value['size'], `${path}.size`),
    sha256: requireString(value['sha256'], `${path}.sha256`),
  };
  if (value['content'] !== undefined) {
    file.content = requireString(value['content'], `${path}.content`);
  }
  if (value['truncated'] !== undefined) {
    if (typeof value['truncated'] !== 'boolean') fail(`${path}.truncated`, 'boolean');
    file.truncated = value['truncated'];
  }
  return file;
}

/**
 * Validate an unknown value (e.g. JSON.parse output of a fixture manifest)
 * into a typed Manifest. Throws with a descriptive message on shape errors.
 */
export function parseManifest(value: unknown): Manifest {
  if (!isRecord(value)) fail('$', 'object');
  if (!Array.isArray(value['files'])) fail('$.files', 'array');
  if (!isRecord(value['stats'])) fail('$.stats', 'object');

  const manifest: Manifest = {
    root: requireString(value['root'], '$.root'),
    cwdBasename: requireString(value['cwdBasename'], '$.cwdBasename'),
    files: value['files'].map((f, i) => parseFile(f, `$.files[${i}]`)),
    stats: {
      fileCount: requireNumber(value['stats']['fileCount'], '$.stats.fileCount'),
      totalBytes: requireNumber(value['stats']['totalBytes'], '$.stats.totalBytes'),
    },
  };
  if (value['stats']['skipped'] !== undefined) {
    manifest.stats.skipped = requireNumber(value['stats']['skipped'], '$.stats.skipped');
  }
  if (value['scope'] !== undefined) {
    if (value['scope'] !== 'project' && value['scope'] !== 'global') {
      fail('$.scope', "'project' | 'global'");
    }
    manifest.scope = value['scope'];
  }
  if (value['localOnly'] !== undefined) {
    if (typeof value['localOnly'] !== 'boolean') fail('$.localOnly', 'boolean');
    manifest.localOnly = value['localOnly'];
  }
  return manifest;
}
