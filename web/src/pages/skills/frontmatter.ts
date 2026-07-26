/**
 * Minimal YAML-frontmatter split + parse for SKILL.md / agent .md files
 * (bead agentconfig-wmc.4). DOM-free and dependency-free — NO yaml dep, by
 * design: the frontmatter of skill/agent files is simple `key: value` + list
 * lines, and we hand-roll a resilient reader for it. React-free so it is
 * unit-testable in isolation.
 *
 * EVERYTHING here treats the file text as ADVERSARIAL: values only ever become
 * plain strings (or arrays of strings), never markup, never `[object Object]`,
 * and a malformed line is skipped rather than throwing. The page then emits
 * every value as a text node.
 *
 * Scope of the parser (deliberately small):
 *   - a document has frontmatter only when its FIRST line is a `---` fence;
 *     the block runs to the next `---` fence line.
 *   - top-level `key: value`  → scalar (quotes stripped)
 *   - top-level `key: [a, b]` → inline flow list
 *   - top-level `key:` then more-indented `- item` lines → block list
 *   - top-level `key:` then more-indented `subkey: val` lines → block captured
 *     as a flat string[] (`subkey: val`, or nested `- item`s) — good enough for
 *     the card view and edge derivation without a real YAML tree.
 * Deeper structure is flattened, not modelled. That is intentional: this feeds
 * a visual card, not a config loader.
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
 * fence; otherwise `frontmatter` is null and `body` is the whole document.
 * Line endings are normalized to `\n` for splitting; the returned strings use
 * `\n`.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const text = content.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) {
    return { frontmatter: null, body: content };
  }
  // Find the closing fence (first fence after line 0).
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i] ?? '')) {
      const frontmatter = lines.slice(1, i).join('\n');
      const body = lines.slice(i + 1).join('\n');
      return { frontmatter, body };
    }
  }
  // Opening fence with no close: no valid frontmatter — treat as body.
  return { frontmatter: null, body: content };
}

/** Strip one layer of matching single/double quotes and trim. */
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      return v.slice(1, -1);
    }
  }
  return v;
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

/** Leading-space count (indentation) of a line. */
function indentOf(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

/** Match a `key: rest` line; returns the key and the remainder, or null. */
function matchKey(line: string): { key: string; rest: string } | null {
  // A key is the text before the first colon; it must be non-empty and not
  // start the line with a colon. `rest` may be empty.
  const idx = line.indexOf(':');
  if (idx <= 0) return null;
  const key = line.slice(0, idx).trim();
  if (key === '') return null;
  const rest = line.slice(idx + 1).trim();
  return { key, rest };
}

/**
 * Parse a raw frontmatter block (the text between the fences, or any string)
 * into ordered top-level entries. Resilient by construction: unrecognized
 * lines, comments (`#…`) and blanks are skipped; duplicate keys keep the LAST
 * occurrence's value but their original position.
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

/** Look up one entry's value by key (first match), or undefined. */
export function getField(entries: readonly FmEntry[], key: string): FmValue | undefined {
  return entries.find((e) => e.key === key)?.value;
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

/** Coerce any FmValue to a single display string. */
export function asScalar(value: FmValue | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}
