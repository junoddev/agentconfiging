/**
 * Pure browse logic for the CATALOG page (bead agentconfig-0zm.3). DOM-free and
 * React-free so the load-bearing behaviour — SHELF grouping, SEARCH/FILTER,
 * installed-state derivation, and QUICK-ADD candidate selection — is unit
 * testable over plain metadata; Catalog.tsx and QuickAdd.tsx are thin renderers
 * over these helpers.
 *
 * Every input is UNTRUSTED registry text (names/descriptions/tags/kinds). These
 * functions only ever compare/lower-case strings into plain values; nothing here
 * produces markup. Callers render every field as a text node.
 */

import type { CatalogEntryMeta, InstalledRecord } from '../api/types.js';

/** Kinds we treat as directly installable artifacts (DESIGN §6, SPEC §4.5). */
export const INSTALLABLE_KINDS = [
  'skill',
  'subagent',
  'rule',
  'mcp-server',
  'hook',
  'command',
] as const;

const INSTALLABLE = new Set<string>(INSTALLABLE_KINDS);

/** The tag the seed stamps on installable template artifacts. */
export const TEMPLATE_TAG = 'template';

// ── Shelves ──────────────────────────────────────────────────────────────────

/** A shelf definition: a title/note and the predicate that claims an entry. */
export interface ShelfSpec {
  id: string;
  title: string;
  /** Terse §7 note under the shelf title. */
  note: string;
  match: (entry: CatalogEntryMeta) => boolean;
}

/** A materialized shelf: its spec metadata plus the entries assigned to it. */
export interface Shelf {
  id: string;
  title: string;
  note: string;
  entries: CatalogEntryMeta[];
}

/**
 * Default shelving (SPEC §4.5 — both shelves): installable artifacts on one
 * shelf, runtime setup on another. Partition is FIRST-MATCH, so an entry lands
 * on exactly one shelf and is never duplicated. A catch-all keeps any future/
 * unknown kind visible rather than silently dropped.
 */
export const DEFAULT_SHELVES: ShelfSpec[] = [
  {
    id: 'artifacts',
    title: 'Artifacts',
    note: 'Installable skills, subagents, rules, hooks, commands & MCP servers.',
    match: (e) => INSTALLABLE.has(e.kind),
  },
  {
    id: 'runtime',
    title: 'Runtime setup',
    note: 'Runtime scaffolding installed once per project.',
    match: (e) => e.kind === 'runtime-template',
  },
];

const FALLBACK_SHELF: ShelfSpec = {
  id: 'other',
  title: 'Other',
  note: 'Uncategorised registry entries.',
  match: () => true,
};

/**
 * Assign each entry to the FIRST shelf whose predicate matches (else a trailing
 * catch-all), preserving entry order within a shelf. Returns only NON-EMPTY
 * shelves so the UI never renders a bare heading.
 */
export function shelveEntries(
  entries: CatalogEntryMeta[],
  specs: ShelfSpec[] = DEFAULT_SHELVES,
): Shelf[] {
  const all = [...specs, FALLBACK_SHELF];
  const buckets = new Map<string, CatalogEntryMeta[]>();
  for (const spec of all) buckets.set(spec.id, []);

  for (const entry of entries) {
    const spec = all.find((s) => s.match(entry)) ?? FALLBACK_SHELF;
    buckets.get(spec.id)?.push(entry);
  }

  const shelves: Shelf[] = [];
  for (const spec of all) {
    const bucket = buckets.get(spec.id) ?? [];
    if (bucket.length > 0) {
      shelves.push({ id: spec.id, title: spec.title, note: spec.note, entries: bucket });
    }
  }
  return shelves;
}

// ── Search / filter ──────────────────────────────────────────────────────────

/** The active browse filter: a free-text query + a set of kinds + a templates toggle. */
export interface CatalogFilter {
  /** Matched (case-insensitively, AND over whitespace terms) against name/description/kind/tags. */
  query: string;
  /** When non-empty, only these kinds pass. Empty = all kinds. */
  kinds: string[];
  /** When true, only entries tagged `template` pass. */
  templatesOnly: boolean;
}

/** An empty filter that passes every entry. */
export const EMPTY_FILTER: CatalogFilter = { query: '', kinds: [], templatesOnly: false };

/**
 * Does an entry match a free-text query? Case-insensitive AND over whitespace-
 * separated terms, searching name + description + kind + tags. An empty/blank
 * query matches everything.
 */
export function entryMatchesQuery(entry: CatalogEntryMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const hay = [entry.name, entry.description, entry.kind, ...entry.tags].join(' ').toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

/** Apply the full filter (kinds ∧ templatesOnly ∧ query), preserving order. */
export function filterEntries(
  entries: CatalogEntryMeta[],
  filter: CatalogFilter,
): CatalogEntryMeta[] {
  const kinds = filter.kinds.length > 0 ? new Set(filter.kinds) : undefined;
  return entries.filter(
    (e) =>
      (kinds === undefined || kinds.has(e.kind)) &&
      (!filter.templatesOnly || e.tags.includes(TEMPLATE_TAG)) &&
      entryMatchesQuery(e, filter.query),
  );
}

/** The distinct kinds present in a catalog, codepoint-sorted — drives filter chips. */
export function kindsPresent(entries: CatalogEntryMeta[]): string[] {
  return [...new Set(entries.map((e) => e.kind))].sort();
}

/** How many entries carry the `template` tag (drives the templates chip + count). */
export function templateCount(entries: CatalogEntryMeta[]): number {
  return entries.reduce((n, e) => (e.tags.includes(TEMPLATE_TAG) ? n + 1 : n), 0);
}

// ── Installed state ───────────────────────────────────────────────────────────

/** Index the instance's installed records by entry key for O(1) badge lookup. */
export function installedByKey(records: InstalledRecord[]): Map<string, InstalledRecord> {
  const map = new Map<string, InstalledRecord>();
  for (const rec of records) map.set(rec.key, rec);
  return map;
}

/** Is this entry currently installed on the resolved instance? */
export function isInstalled(
  entry: CatalogEntryMeta,
  installed: Map<string, InstalledRecord>,
): boolean {
  return installed.has(entry.key);
}

/** How many of the given entries are installed. */
export function installedCount(
  entries: CatalogEntryMeta[],
  installed: Map<string, InstalledRecord>,
): number {
  return entries.reduce((n, e) => (installed.has(e.key) ? n + 1 : n), 0);
}

// ── Quick-add ─────────────────────────────────────────────────────────────────

/**
 * Candidates for a QUICK-ADD picker scoped to one kind: entries of that kind
 * that are NOT already installed, optionally narrowed by a free-text query.
 * Order is preserved. This is the primitive the reusable QuickAdd component and
 * (later) each editor page filter over.
 */
export function quickAddCandidates(
  entries: CatalogEntryMeta[],
  kind: string,
  installed: Map<string, InstalledRecord>,
  query = '',
): CatalogEntryMeta[] {
  return entries.filter(
    (e) => e.kind === kind && !installed.has(e.key) && entryMatchesQuery(e, query),
  );
}
