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
 *
 * All input (report paths, frontmatter, glob strings) is UNTRUSTED config data:
 * values only ever become plain strings, and the page renders them as TEXT
 * nodes — never markup, never `dangerouslySetInnerHTML`.
 */

import type { Report } from '../../api/types.js';
import { collectFiles, collectGlobalFiles, groupByRoot } from '../../lib/collect.js';
import {
  asScalar,
  getField,
  parseFrontmatter,
  splitFrontmatter,
  unquote,
  type FmValue,
} from '../../lib/frontmatter.js';
import { joinGlobalPath } from '../../lib/paths.js';

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

/** Deterministic rule order: source, then name, then path. Shared by the
 *  project and global collectors so both lists sort identically. */
function byRuleOrder(a: RuleEntry, b: RuleEntry): number {
  return (
    a.source.localeCompare(b.source) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path)
  );
}

/** Every rule file referenced by any detected agent, de-duplicated by path and
 *  deterministically ordered (source, then name, then path). */
export function collectRules(report: Report | undefined): RuleEntry[] {
  return collectFiles(report?.agents ?? [], classifyRule, byRuleOrder);
}

// ── Inherited global rules (bead 71h.5) ─────────────────────────────────────

/** The slice of a machine-global report entry this page consumes. */
export interface GlobalRuleSource {
  /** Absolute path of the global config dir (e.g. '/Users/x/.claude'). */
  root: string;
  /** Well-known dir name under home (e.g. '.claude', '.cursor'). */
  dir: string;
  agents: readonly { files: string[] }[];
}

/** An inherited rule. `path` is ABSOLUTE (root-joined) and only ever fed to
 *  getFile — it must never enter any write-target list. */
export interface GlobalRuleEntry extends RuleEntry {
  /** The global config dir the file came from. */
  root: string;
}

// Global paths are RELATIVE TO THE CONFIG DIR (no `.claude/` prefix): a rule
// under ~/.claude is `rules/x.md`; under ~/.cursor it is `rules/x.mdc`.
const GLOBAL_CLAUDE_RULE_RE = /(?:^|\/)rules\/([^/]+)\.md$/i;
const GLOBAL_CURSOR_RULE_RE = /(?:^|\/)rules\/([^/]+)\.mdc$/i;

/** Classify a global entry's root-relative path as a rule for that runtime dir,
 *  or null. Only `.claude` (rules/*.md) and `.cursor` (rules/*.mdc) carry rules. */
export function classifyGlobalRule(
  dir: string,
  relPath: string,
): { source: RuleSource; name: string } | null {
  const norm = relPath.replace(/\\/g, '/');
  if (dir === '.claude') {
    const m = GLOBAL_CLAUDE_RULE_RE.exec(norm);
    return m ? { source: 'claude', name: m[1] as string } : null;
  }
  if (dir === '.cursor') {
    const m = GLOBAL_CURSOR_RULE_RE.exec(norm);
    return m ? { source: 'cursor', name: m[1] as string } : null;
  }
  return null;
}

/** Inherited rules from the global `.claude`/`.cursor` entries, absolute-joined,
 *  de-duped, and ordered like collectRules. No matches ⇒ [] (page unchanged). */
export function collectGlobalRules(entries: readonly GlobalRuleSource[]): GlobalRuleEntry[] {
  return collectGlobalFiles(
    entries,
    (entry, rel) => {
      const classified = classifyGlobalRule(entry.dir, rel);
      if (!classified) return null;
      return { ...classified, path: joinGlobalPath(entry.root, rel), root: entry.root };
    },
    byRuleOrder,
  );
}

/** One global root's inherited rules, for a `GLOBAL · ~/.claude` list heading. */
export interface GlobalRuleGroup {
  root: string;
  rules: GlobalRuleEntry[];
}

/** Group inherited rules by their global root, preserving the collector's
 *  order. Empty input ⇒ no groups (never an empty GLOBAL heading). */
export function groupGlobalRulesByRoot(rules: readonly GlobalRuleEntry[]): GlobalRuleGroup[] {
  return groupByRoot(rules).map((group) => ({ root: group.root, rules: group.items }));
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
