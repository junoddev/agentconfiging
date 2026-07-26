/**
 * Pure logic for the Rules editor (bead agentconfig-wmc.6). DOM-free and
 * React-free so the load-bearing rules are unit-testable over plain data;
 * Rules.tsx is a thin renderer over these helpers.
 *
 * Jobs:
 *   1. DISCOVER the instance's contextual rules from the report — a UNIFIED
 *      surface over BOTH `.claude/rules/*.md` (plain markdown, no frontmatter)
 *      and Cursor `.cursor/rules/*.mdc` (YAML frontmatter with globs).
 *   2. Parse a rule into its PATH FILTERS (globs → badges), description, and
 *      always-apply flag, coping with Cursor's bare comma-separated globs form
 *      which is NOT strict YAML, plus brace expansion like `*.{ts,tsx}`.
 *   3. REDACTION-save guard (spans OR `[REDACTED:*]` marks — belt-and-braces).
 *   4. A minimal, SAFE Markdown block tokenizer for the preview pane.
 *
 * All input (report paths, frontmatter, glob strings) is UNTRUSTED config data:
 * values only ever become plain strings, and the page renders them as TEXT
 * nodes — never markup, never `dangerouslySetInnerHTML`.
 */

import type { Report } from '../../api/types.js';
import {
  asScalar,
  getField,
  parseFrontmatter,
  splitFrontmatter,
  unquote,
  type FmValue,
} from './frontmatter.js';

// ── Discovery ──────────────────────────────────────────────────────────────

/** Which agent runtime a rule belongs to. */
export type RuleSource = 'claude' | 'cursor';

/** A discovered contextual-rule file. */
export interface RuleEntry {
  source: RuleSource;
  /** Display name — the rule file's basename without its extension. */
  name: string;
  /** The report-relative path (fed straight to getFile / writeFile). */
  path: string;
}

const CLAUDE_RULE_RE = /(?:^|\/)\.claude\/rules\/([^/]+)\.md$/i;
const CURSOR_RULE_RE = /(?:^|\/)\.cursor\/rules\/([^/]+)\.mdc$/i;

/** Classify a path as a `.claude/rules/*.md` or `.cursor/rules/*.mdc` rule, or
 *  null when it is neither. Separators are normalized so Windows-style paths
 *  still match. */
export function classifyRule(path: string): RuleEntry | null {
  const norm = path.replace(/\\/g, '/');
  const claude = CLAUDE_RULE_RE.exec(norm);
  if (claude) return { source: 'claude', name: claude[1] as string, path };
  const cursor = CURSOR_RULE_RE.exec(norm);
  if (cursor) return { source: 'cursor', name: cursor[1] as string, path };
  return null;
}

/** Every rule file referenced by any detected agent, de-duplicated by path and
 *  deterministically ordered (source, then name, then path). */
export function collectRules(report: Report | undefined): RuleEntry[] {
  const byPath = new Map<string, RuleEntry>();
  for (const agent of report?.agents ?? []) {
    for (const file of agent.files) {
      const entry = classifyRule(file);
      if (entry && !byPath.has(entry.path)) byPath.set(entry.path, entry);
    }
  }
  return [...byPath.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path),
  );
}

// ── Path-filter (glob) parsing ─────────────────────────────────────────────

/**
 * Split one bare glob scalar on commas that are OUTSIDE `{…}` braces, so a
 * brace-expansion glob like `*.{ts,tsx}` stays one token while Cursor's bare
 * comma-separated form `*.tsx,src/components/**` splits into two. Items are
 * trimmed, unquoted, and empties dropped.
 */
export function splitGlobScalar(scalar: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of scalar) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => unquote(s)).filter((s) => s !== '');
}

/**
 * Normalize a frontmatter `globs` value into a flat list of path-filter globs.
 * Handles all three shapes seen in the wild:
 *   - a YAML/inline list (already split into items) → each item, brace-safe;
 *   - a bare comma-separated scalar (`*.tsx,src/**`) → split on top-level commas;
 *   - a single glob scalar → one item.
 * Undefined/empty degrades to `[]`. Deterministic, adversarial-safe.
 */
export function parseGlobs(value: FmValue | undefined): string[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => splitGlobScalar(item));
}

/** Coerce a frontmatter scalar to a boolean (`true`/`yes`/`on` → true). */
export function parseBool(value: FmValue | undefined): boolean {
  const s = asScalar(value).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'on';
}

// ── Rule parse ──────────────────────────────────────────────────────────────

/** A rule's parsed shape: its path-filter badges, description, and body. */
export interface ParsedRule {
  /** One-line description from frontmatter (empty when none). */
  description: string;
  /** Path-filter globs shown as badges (empty for an unscoped/always rule). */
  pathFilters: string[];
  /** `alwaysApply: true` — applies regardless of path. */
  alwaysApply: boolean;
  /** Whether the file carried a frontmatter block at all. */
  hasFrontmatter: boolean;
  /** The markdown body after the frontmatter (or the whole file when none). */
  body: string;
}

/**
 * Parse a rule file's raw content into its display shape. `.claude/rules/*.md`
 * files usually have NO frontmatter — the whole file is the body, with no path
 * filters (an always-in-context rule). `.cursor/rules/*.mdc` carry frontmatter
 * with `description`, `globs`, and `alwaysApply`.
 */
export function parseRule(content: string): ParsedRule {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) {
    return {
      description: '',
      pathFilters: [],
      alwaysApply: false,
      hasFrontmatter: false,
      body: content,
    };
  }
  const fm = parseFrontmatter(frontmatter);
  return {
    description: asScalar(getField(fm, 'description')).trim(),
    pathFilters: parseGlobs(getField(fm, 'globs')),
    alwaysApply: parseBool(getField(fm, 'alwaysApply')),
    hasFrontmatter: true,
    body,
  };
}

// ── Redaction guard (belt-and-braces) ───────────────────────────────────────

/** Matches a server-inserted `[REDACTED:*]` placeholder mark. */
const REDACTION_RE = /\[REDACTED:[^\]]*\]/;

/** True when text carries a `[REDACTED:*]` mark. */
export function hasRedactionMarks(content: string): boolean {
  return REDACTION_RE.test(content);
}

/**
 * True when a loaded file must be READ-ONLY: the server flagged redaction spans
 * OR the served text carries a `[REDACTED:*]` mark. Committing such text would
 * overwrite the real on-disk secret with the placeholder — so both signals are
 * checked (rules rarely hold secrets, but the guard is cheap and load-bearing).
 */
export function isRedacted(spans: readonly unknown[], content: string): boolean {
  return spans.length > 0 || hasRedactionMarks(content);
}

// ── Minimal safe Markdown tokenizer (preview pane) ──────────────────────────

/** A preview block. The React side renders each as a TEXT node in an
 *  appropriate element — no inline HTML, no `dangerouslySetInnerHTML`. */
export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'para'; text: string };

const FENCE_RE = /^\s*(?:```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+/;
const QUOTE_RE = /^\s*>\s?(.*)$/;

/**
 * Tokenize Markdown into safe preview blocks. Fenced code is captured verbatim
 * (never scanned for structure); consecutive list items and paragraph lines are
 * grouped. Unterminated fences flush at end of input.
 */
export function tokenizeMarkdown(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = content.split('\n');

  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let code: string[] | undefined;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', text: para.join('\n') });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
      list = undefined;
    }
  };
  const flushOpen = () => {
    flushPara();
    flushList();
  };

  for (const line of lines) {
    if (code !== undefined) {
      if (FENCE_RE.test(line)) {
        blocks.push({ kind: 'code', text: code.join('\n') });
        code = undefined;
      } else {
        code.push(line);
      }
      continue;
    }

    if (FENCE_RE.test(line)) {
      flushOpen();
      code = [];
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushOpen();
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      flushOpen();
      blocks.push({ kind: 'quote', text: quote[1] ?? '' });
      continue;
    }

    const item = LIST_RE.exec(line);
    if (item) {
      flushPara();
      const ordered = ORDERED_RE.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[1] ?? '');
      continue;
    }

    if (line.trim() === '') {
      flushOpen();
      continue;
    }

    flushList();
    para.push(line);
  }

  if (code !== undefined) blocks.push({ kind: 'code', text: code.join('\n') });
  flushOpen();

  return blocks;
}
