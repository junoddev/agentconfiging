/** Pure SourceBadge helpers — kept out of the component for unit tests. */

/** Which config scope a piece of config came from. `default` marks an
 *  effective-config value that came from no file at all. */
export type SourceScope = 'project' | 'local' | 'global' | 'default';

/** Console §5 contract class for a scope (`.scope.s-*`). */
export function scopeClass(scope: SourceScope): string {
  return `s-${scope}`;
}

/**
 * Compose the badge text (DESIGN §7 voice): the scope name, an optional detail
 * (e.g. '~/.claude' or 'gitignored'), and an optional READ-ONLY marker —
 * mid-dot separated. The scope and marker are uppercased here (not via CSS) so
 * the detail slot preserves path case (~/.claude is case-sensitive on Linux);
 * `.scope.source-badge` disables the contract uppercase transform to match.
 */
export function sourceBadgeText(scope: SourceScope, detail?: string, readOnly?: boolean): string {
  const parts: string[] = [scope.toUpperCase()];
  if (detail !== undefined && detail !== '') parts.push(detail);
  if (readOnly) parts.push('READ-ONLY');
  return parts.join(' · ');
}
