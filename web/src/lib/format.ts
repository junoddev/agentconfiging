/** Pure display helpers for the web UI. */

/** "1 finding" / "3 findings" — used in status lines and badges. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** '/Users/x/.claude' → '~/.claude' — home-relative display for global paths.
 *  Heuristic (the client never learns the real home dir): collapses a leading
 *  macOS/Linux home prefix; anything else passes through unchanged. */
export function homeRel(path: string): string {
  const match = /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(path);
  return match ? `~${path.slice(match[0].length)}` : path;
}
