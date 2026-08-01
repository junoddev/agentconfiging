/**
 * ONE unified, dependency-free YAML-frontmatter reader/writer, reconciling the
 * three previously-diverged per-page copies (rules / skills / memory). DOM-free
 * and React-free so it stays unit-testable in isolation.
 *
 * EVERYTHING here treats the file text as ADVERSARIAL: values only ever become
 * plain strings (or arrays of strings), never markup, never `[object Object]`;
 * a malformed line is skipped rather than throwing. On emit, any scalar that
 * could break the `key: value` shape is single-quoted (inner quotes doubled) so
 * a round-trip is lossless and no injected newline/colon can smuggle structure.
 *
 * RECONCILIATION NOTES (behavioral superset of all three copies):
 *   - `getField` is CASE-INSENSITIVE (was so in rules, case-sensitive in skills).
 *     Skill/memory keys are lowercase, so exact-case callers are unaffected; the
 *     only change is that a differently-cased duplicate now also matches.
 *   - `unquote` collapses doubled inner quotes (`''`→`'`, `""`→`"`) — memory's
 *     behavior, needed for the `emitScalar` round-trip. Rule/skill values never
 *     carry doubled quotes, so their parse is unchanged.
 *   - Both the rich reader (`parseFrontmatter` → ordered `FmEntry[]` with block /
 *     flow lists) and memory's scalar-only reader/writer (`parseScalars` /
 *     `emitScalar`) live here; memory keeps using the scalar pair.
 */

/** A parsed frontmatter value: a scalar, or a list of scalars. */
export type FmValue = string | string[];

/** One ordered frontmatter entry (display order is preserved). */
export interface FmEntry {
  key: string;
  value: FmValue;
}

/** The result of splitting a document into its frontmatter block and body. */
export interface FrontmatterSplit {
  /** Raw frontmatter text (between the fences), or null when there is none. */
  frontmatter: string | null;
  /** The document body after the closing fence (or the whole doc when none). */
  body: string;
}

const FENCE = /^---\s*$/;

/**
 * Split a document into `{ frontmatter, body }`. Frontmatter exists ONLY when
 * the very first line is a `---` fence and a later line is a closing `---`
 * fence; otherwise `frontmatter` is null and `body` is the whole document (the
 * common `.claude/rules/*.md` case — plain markdown, no frontmatter). Line
 * endings are normalized to `\n` for splitting; the returned strings use `\n`.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const text = content.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) {
    return { frontmatter: null, body: content };
  }
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? '')) {
      return { frontmatter: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    }
  }
  // Opening fence with no close: no valid frontmatter — treat as body.
  return { frontmatter: null, body: content };
}

/** Strip one layer of matching single/double quotes (doubled inner quotes are
 *  collapsed) and trim. */
export function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const q = v[0];
    if ((q === '"' || q === "'") && v[v.length - 1] === q) {
      return v.slice(1, -1).replace(q === '"' ? /""/g : /''/g, q);
    }
  }
  return v;
}

/** Leading-space count (indentation) of a line. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

/** Match a `key: rest` line; returns the key and the remainder, or null. */
function matchKey(line: string): { key: string; rest: string } | null {
  const idx = line.indexOf(':');
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  if (key === '') return null;
  const rest = line.slice(idx + 1).trim();
  return { key, rest };
}

/** Parse an inline flow list `[a, b, "c"]` into trimmed, unquoted, non-empty
 *  items. Adversarial input degrades to an empty list rather than throwing. */
function parseFlowList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1);
  if (inner.trim() === '') return [];
  return inner
    .split(',')
    .map((p) => unquote(p))
    .filter((p) => p.length !== 0);
}

/**
 * Parse a raw frontmatter block into ordered top-level entries. Resilient:
 * unrecognized lines, comments (`#…`) and blanks are skipped; a `key:` with a
 * more-indented `- item` block becomes a string list; a nested `subkey: val`
 * block is flattened to a flat `string[]` (`subkey: val` / bare `- item`s), good
 * enough for a card view without a real YAML tree; duplicate keys keep the LAST
 * value at their original position.
 */
export function parseFrontmatter(frontmatter: string): FmEntry[] {
  const lines = frontmatter.replace(/\r\n?/g, '\n').split('\n');
  const entries: FmEntry[] = [];
  const indexByKey = new Map<string, number>();

  const setEntry = (key: string, value: FmValue): void => {
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      const slot = entries[existing];
      if (slot) slot.value = value;
      return;
    }
    indexByKey.set(key, entries.length);
    entries.push({ key, value });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (indentOf(line) !== 0) continue; // only top-level keys start an entry
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const m = matchKey(line);
    if (!m) continue; // resilient: skip anything that isn't a key line

    if (m.rest === '') {
      // Block value: gather the following more-indented lines.
      const block: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j] ?? '';
        if (next.trim() === '') continue; // blank lines inside a block are ok
        if (indentOf(next) === 0) break; // back to top level → block ends
        const t = next.trim();
        if (t.startsWith('#')) continue;
        if (t.startsWith('- ')) {
          block.push(unquote(t.slice(2)));
        } else if (t === '-') {
          continue; // empty list marker
        } else {
          const sub = matchKey(next);
          if (sub) block.push(sub.rest === '' ? sub.key : `${sub.key}: ${unquote(sub.rest)}`);
        }
      }
      i = j - 1;
      setEntry(m.key, block);
    } else if (m.rest.startsWith('[') && m.rest.endsWith(']')) {
      setEntry(m.key, parseFlowList(m.rest));
    } else {
      setEntry(m.key, unquote(m.rest));
    }
  }

  return entries;
}

/** Look up one entry's value by key (first match, CASE-INSENSITIVE), or
 *  undefined. */
export function getField(entries: readonly FmEntry[], key: string): FmValue | undefined {
  return entries.find((e) => e.key.toLowerCase() === key.toLowerCase())?.value;
}

/** Coerce any FmValue to a single display string. */
export function asScalar(value: FmValue | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Coerce any FmValue to a display list (scalars split on commas for the
 *  `tools: a, b` shorthand; empty items dropped). */
export function asList(value: FmValue | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v) => v.trim() !== '');
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

// ── Scalar-only reader / writer (memory field editor) ────────────────────────

/**
 * Parse a raw frontmatter block into a flat map of top-level scalar fields
 * (last write wins on a duplicate key). Blank lines, comments (`#…`), indented
 * lines, and anything that is not a `key: value` scalar are skipped — resilient
 * by construction so malformed frontmatter never throws. Block/list openers
 * (`key:` alone, or `key: [..]`) are kept as their raw remainder rather than
 * modelled (out of scope for the scalar editor).
 */
export function parseScalars(frontmatter: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of frontmatter.replace(/\r\n?/g, '\n').split('\n')) {
    if (raw.length > 0 && raw[0] === ' ') continue; // only top-level keys
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const idx = raw.indexOf(':');
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    if (key === '') continue;
    const rest = raw.slice(idx + 1).trim();
    // Ignore block/list openers (`key:` alone, or `key: [..]`) — out of scope.
    if (rest === '' || (rest.startsWith('[') && rest.endsWith(']'))) {
      out[key] = rest === '' ? '' : rest;
      continue;
    }
    out[key] = unquote(rest);
  }
  return out;
}

/** True when a scalar value would be unsafe as a bare `key: value` (could inject
 *  structure or be misread). Such values are quoted on emit. */
function needsQuote(value: string): boolean {
  if (value === '') return false; // `key:` is a valid empty scalar
  if (value !== value.trim()) return true; // leading/trailing whitespace
  if (/[:#]/.test(value)) return true; // colon / comment char
  if (value.includes("'")) return true; // embedded quote → doubled + wrapped
  if (/[\n\r]/.test(value)) return true; // newline (structure injection)
  return '"\'[]{}>|&*!%@`,'.includes(value[0] ?? ''); // ambiguous YAML leads
}

/** Emit one frontmatter line, single-quoting (and doubling inner quotes) when
 *  the value would otherwise break the `key: value` shape. */
export function emitScalar(key: string, value: string): string {
  if (!needsQuote(value)) return `${key}: ${value}`;
  return `${key}: '${value.replace(/'/g, "''").replace(/[\n\r]+/g, ' ')}'`;
}
