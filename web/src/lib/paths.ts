/**
 * Shared path helpers for machine-global (inherited) config files (extracted
 * from the instructions / rules / skills / memory / artifacts / agents logic
 * modules, which each carried a private copy).
 *
 * Global report entries carry file paths RELATIVE to their config-dir `root`,
 * but the file API (getFile) addresses global files by ABSOLUTE path — so each
 * inherited file needs its root and its relative path joined into one absolute
 * key. These absolute paths are READ-ONLY selectors: no write flow ever derives
 * a write target from them.
 */

/**
 * Join a global root and a root-relative path into one absolute path. The root's
 * trailing slashes and the rel's leading slashes are normalized so exactly one
 * separator sits between them (roots are realpaths without a trailing slash, but
 * this is defensive).
 */
export function joinGlobalPath(root: string, rel: string): string {
  return `${root.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;
}
