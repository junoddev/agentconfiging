/**
 * Pure browse logic for the MARKETPLACE page (bead 0zm.5). DOM-free and
 * React-free so the load-bearing behaviour — SEARCH, install-count SORT, and
 * installed-state derivation — is unit-testable over plain metadata;
 * Marketplace.tsx is a thin renderer over these helpers.
 *
 * Every input is UNTRUSTED subprocess output (plugin names/descriptions from
 * other people's marketplace entries). These functions only compare/lower-case
 * strings into plain values; nothing here produces markup. Callers render every
 * field as a text node.
 */

import type { InstalledPlugin, MarketplacePlugin } from '../../api/types.js';

/**
 * Case-insensitive AND over whitespace-separated terms, searching name +
 * description + marketplace + id. An empty/blank query matches everything.
 */
export function pluginMatchesQuery(plugin: MarketplacePlugin, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const hay = [plugin.name, plugin.description, plugin.marketplace, plugin.id]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

/** Filter by query, then SORT by install count (desc), stable for ties/absent
 *  counts. A missing count sinks below any counted plugin. Never mutates input. */
export function filterPlugins(plugins: MarketplacePlugin[], query: string): MarketplacePlugin[] {
  return plugins
    .filter((p) => pluginMatchesQuery(p, query))
    .slice()
    .sort((a, b) => (b.installCount ?? -1) - (a.installCount ?? -1));
}

/** The set of identifiers already installed — matched by id AND by name, since a
 *  listing entry and its installed record may key on either. Drives the badge. */
export function installedKeys(installed: InstalledPlugin[]): Set<string> {
  const keys = new Set<string>();
  for (const rec of installed) {
    if (rec.id !== '') keys.add(rec.id);
    if (rec.name !== '') keys.add(rec.name);
  }
  return keys;
}

/** Is this listing plugin already installed? */
export function isPluginInstalled(plugin: MarketplacePlugin, keys: Set<string>): boolean {
  return keys.has(plugin.id) || keys.has(plugin.name);
}

/** Format an install count with thousands separators, or '—' when absent. */
export function formatInstallCount(count: number | undefined): string {
  if (count === undefined || !Number.isFinite(count)) return '—';
  return count.toLocaleString('en-US');
}
