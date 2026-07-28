/** Pure SourceBadge helpers — kept out of the component for unit tests. */

/** Which config scope a piece of config came from. */
export type SourceScope = 'project' | 'local' | 'global';

/**
 * Compose the badge text (DESIGN §7 voice): the scope name, an optional detail
 * (e.g. '~/.claude' or 'gitignored'), and an optional READ-ONLY marker —
 * mid-dot separated. The micro-label class uppercases the rendering; the scope
 * and marker are uppercased here too so the text content is deterministic.
 */
export function sourceBadgeText(scope: SourceScope, detail?: string, readOnly?: boolean): string {
  const parts: string[] = [scope.toUpperCase()];
  if (detail !== undefined && detail !== '') parts.push(detail);
  if (readOnly) parts.push('READ-ONLY');
  return parts.join(' · ');
}
