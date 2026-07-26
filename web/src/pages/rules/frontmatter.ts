/**
 * Minimal, dependency-free YAML-frontmatter split + parse for the Rules editor
 * (bead agentconfig-wmc.6). A private copy for pages/rules/ (page dirs do NOT
 * import across each other) — same resilient hand-rolled reader the Skills and
 * Instructions editors use, scoped to what a rule file needs: a `description`
 * scalar, an `alwaysApply` boolean, and a `globs` value that may arrive as a
 * YAML block list, an inline flow list, OR Cursor's bare comma-separated form
 * (`globs: *.tsx,src/components/**`), which is NOT strict YAML.
 *
 * EVERYTHING here treats the file text as ADVERSARIAL: values only ever become
 * plain strings (or arrays of strings), never markup; a malformed line is
 * skipped rather than throwing. The page emits every value as a TEXT node.
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
 * fence; otherwise `frontmatter` is null and `body` is the whole document
 * (the common `.claude/rules/*.md` case — plain markdown, no frontmatter).
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const text = content.replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || !FENCE.test(lines[0] ?? '')) {
    return { frontmatter: null, body: content };
  }
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
export function unquote(raw: string): string {
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
 * more-indented `- item` block becomes a string list; duplicate keys keep the
 * LAST value at their original position.
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
    if (!m) continue;

    if (m.rest === '') {
      // Block value: gather the following more-indented `- item` lines.
      const block: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j] ?? '';
        if (next.trim() === '') continue;
        if (indentOf(next) === 0) break; // back to top level → block ends
        const t = next.trim();
        if (t.startsWith('#')) continue;
        if (t.startsWith('- ')) {
          block.push(unquote(t.slice(2)));
        } else if (t === '-') {
          continue;
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
  return entries.find((e) => e.key.toLowerCase() === key.toLowerCase())?.value;
}

/** Coerce any FmValue to a single display string. */
export function asScalar(value: FmValue | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}
