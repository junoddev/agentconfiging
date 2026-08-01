/**
 * Shared file-load error voice (extracted from Instructions / Rules / Skills /
 * Artifacts, which each carried an identical private copy). Maps an API failure
 * to one honest, terse line (§7 voice) for a "File unavailable" empty state.
 */

import { ApiError } from '../api/index.js';

/** Honest one-line error voice per API failure kind (§7). */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'notfound') return 'file not found';
    if (err.kind === 'forbidden') return 'file out of scope';
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not load file';
}
