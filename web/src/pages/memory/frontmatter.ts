/**
 * Minimal YAML-frontmatter split / scalar-parse / scalar-emit for memory
 * files (bead agentconfig-wmc.7). DOM-free and dependency-free — NO yaml dep,
 * by design: a memory file's frontmatter is a handful of simple `key: value`
 * scalars (type / name / description), and we hand-roll a resilient reader +
 * writer for it so the whole thing stays unit-testable in isolation.
 *
 * EVERYTHING here treats the file text as ADVERSARIAL. Parsed values only ever
 * become plain strings; a malformed line is skipped rather than throwing. On
 * emit, any value that could break the `key: value` shape is single-quoted (and
 * embedded quotes doubled) so a round-trip is lossless and no injected newline
 * or colon can smuggle structure into the block.
 *
 * Scope is deliberately tiny: only top-level `key: scalar` lines are read.
 * Lists / nested maps are out of scope for memory frontmatter and are simply
 * ignored — this feeds a card and a small field editor, not a config loader.
 */

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
 * Line endings are normalized to `\n`.
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
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const q = v[0];
    if ((q === '"' || q === "'") && v[v.length - 1] === q) {
      return v.slice(1, -1).replace(q === '"' ? /""/g : /''/g, q);
    }
  }
  return v;
}

/**
 * Parse a raw frontmatter block into a flat map of top-level scalar fields
 * (last write wins on a duplicate key). Blank lines, comments (`#…`), indented
 * lines, and anything that is not a `key: value` scalar are skipped — resilient
 * by construction so malformed frontmatter never throws.
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
