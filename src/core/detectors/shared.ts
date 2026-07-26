/**
 * Shared manifest helpers for detector modules — port of the helper
 * section of ../markdowning `detectors.ex` (find_file/2, files_under/2,
 * any_under?/2, word_count/2), plus `dirPrefix` which adapts the
 * project-scope dir checks to global-scope manifests (new here; the
 * Elixir engine had no global scope).
 */

import type { Manifest, ManifestFile } from '../manifest.js';

/** The manifest file whose path equals `path`, or undefined. */
export function findFile(manifest: Manifest, path: string): ManifestFile | undefined {
  return manifest.files.find((f) => f.path === path);
}

/** Manifest files whose path starts with `prefix` ('' matches all files). */
export function filesUnder(manifest: Manifest, prefix: string): ManifestFile[] {
  return manifest.files.filter((f) => f.path.startsWith(prefix));
}

/** True if any file path starts with `prefix`. */
export function anyUnder(manifest: Manifest, prefix: string): boolean {
  return manifest.files.some((f) => f.path.startsWith(prefix));
}

/**
 * Naive whitespace word count of a file's content; 0 when the file is
 * missing or its content was withheld (binary / over cap).
 */
export function wordCount(manifest: Manifest, path: string): number {
  const content = findFile(manifest, path)?.content;
  if (typeof content !== 'string') return 0;
  return content.split(/\s+/).filter(Boolean).length;
}

/**
 * Path prefix for a runtime's config dir in this manifest.
 *
 * Project scope: files live under `<dir>/` (e.g. '.claude/settings.json')
 * → returns '<dir>/'. Global scope: the manifest root IS the config dir
 * (scanGlobal roots a manifest at ~/.claude, ~/.codex, ... with
 * cwdBasename '.claude' etc.), so its files carry no dir prefix →
 * returns ''.
 *
 * A manifest explicitly marked `scope: 'project'` NEVER gets the global
 * treatment — a repo directory literally named '.claude' must not be
 * mistaken for ~/.claude. When `scope` is absent (fixture manifests
 * never carry it) the cwdBasename convention decides.
 */
export function dirPrefix(manifest: Manifest, dir: string): string {
  if (manifest.scope === 'project') return `${dir}/`;
  return manifest.cwdBasename === dir ? '' : `${dir}/`;
}

/**
 * True when the runtime's config dir has any presence: files under
 * `<dir>/` in project scope, or a non-empty manifest when the manifest
 * root IS the dir (global scope).
 */
export function hasDir(manifest: Manifest, prefix: string): boolean {
  return prefix === '' ? manifest.files.length > 0 : anyUnder(manifest, prefix);
}

/** Insertion-order dedupe (Elixir Enum.uniq port). */
export function uniq(paths: string[]): string[] {
  return [...new Set(paths)];
}
