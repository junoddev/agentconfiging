/**
 * Instructions editor — pure, DOM-free logic (bead agentconfig-wmc.3). Kept out
 * of the component so the load-bearing safety rules are unit-testable over plain
 * data:
 *   - which report files are INSTRUCTION files, and how they group by scope;
 *   - @import extraction that ignores fenced code and email false-positives, and
 *     resolves each ref against the known instance files (present / missing);
 *   - REDACTION-mark detection — the correctness guard that keeps a user from
 *     saving `[REDACTED:*]` placeholder text back over a real on-disk secret;
 *   - a minimal, safe Markdown block tokenizer for the PREVIEW pane (the React
 *     side renders each block as TEXT nodes only — never HTML).
 *
 * All strings handled here come from adversarially-parsed config; nothing is
 * ever interpreted as markup.
 */

import { collectFiles, collectGlobalFiles, groupByRoot } from '../../lib/collect.js';
import { joinGlobalPath } from '../../lib/paths.js';

/** Basenames we treat as agent instruction files (SPEC §5 row 4, multi-runtime). */
const INSTRUCTION_BASENAMES: ReadonlySet<string> = new Set([
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
]);

/** Last path segment (the file name). */
export function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** True when a path is an instruction file at any scope (root or `.claude/`). */
export function isInstructionFile(path: string): boolean {
  return INSTRUCTION_BASENAMES.has(basename(path));
}

/** Two display scopes: the project root, and anything under a `.claude/` dir. */
export type InstructionScope = 'project' | 'claude-dir';

/** A path groups under `.claude/` when it has a `.claude/` directory segment. */
export function scopeOf(path: string): InstructionScope {
  return /(?:^|\/)\.claude\//.test(path) ? 'claude-dir' : 'project';
}

/** The union of every agent's referenced INSTRUCTION files, de-duped and sorted. */
export function collectInstructionFiles(agents: readonly { files: string[] }[]): string[] {
  return collectFiles(agents, (path) => (isInstructionFile(path) ? { path } : null)).map(
    (item) => item.path,
  );
}

/** One scope's files, for the grouped left-hand list. */
export interface InstructionGroup {
  scope: InstructionScope;
  label: string;
  files: string[];
}

const SCOPE_LABEL: Record<InstructionScope, string> = {
  project: 'PROJECT ROOT',
  'claude-dir': '.CLAUDE/',
};

/**
 * Group instruction paths by scope in stable order (project root, then
 * `.claude/`). Empty groups are omitted.
 */
export function groupByScope(paths: readonly string[]): InstructionGroup[] {
  const order: InstructionScope[] = ['project', 'claude-dir'];
  const groups: InstructionGroup[] = [];
  for (const scope of order) {
    const files = paths.filter((p) => scopeOf(p) === scope);
    if (files.length > 0) groups.push({ scope, label: SCOPE_LABEL[scope], files });
  }
  return groups;
}

// ── Inherited global instruction files (bead 71h.5) ────────────────────────

/** The slice of a machine-global report entry this page consumes. */
export interface GlobalInstructionSource {
  /** Absolute path of the global config dir (e.g. '/Users/x/.claude'). */
  root: string;
  agents: readonly { files: string[] }[];
}

/** One inherited instruction file with its provenance. READ-ONLY by
 *  construction: the absolute path is only ever fed to getFile — it must never
 *  enter any write-target list or save flow. */
export interface GlobalInstructionFile {
  /** Absolute path (root-joined) — the getFile key. */
  path: string;
  /** Path relative to its global root — the display label. */
  rel: string;
  /** The global config dir the file came from. */
  root: string;
}

/** Every global entry's INSTRUCTION files (same basename filter as the project
 *  list), as absolute root-joined paths — de-duped, sorted by root then rel.
 *  No global entries ⇒ [] (the page renders exactly as before). */
export function collectGlobalInstructionFiles(
  entries: readonly GlobalInstructionSource[],
): GlobalInstructionFile[] {
  return collectGlobalFiles(
    entries,
    (entry, rel) =>
      isInstructionFile(rel)
        ? { path: joinGlobalPath(entry.root, rel), rel, root: entry.root }
        : null,
    (a, b) => a.root.localeCompare(b.root) || a.rel.localeCompare(b.rel),
  );
}

/** One global root's inherited files, for a `GLOBAL · ~/.claude` list heading. */
export interface GlobalInstructionGroup {
  root: string;
  files: GlobalInstructionFile[];
}

/** Group inherited files by their global root, preserving the collector's
 *  order. Empty input ⇒ no groups (never an empty GLOBAL heading). */
export function groupGlobalByRoot(
  files: readonly GlobalInstructionFile[],
): GlobalInstructionGroup[] {
  return groupByRoot(files).map((group) => ({ root: group.root, files: group.items }));
}

// ── @import references ─────────────────────────────────────────────────────

/** A raw `@import` reference found in an instruction file. */
export interface ImportRef {
  /** The path written after `@`, e.g. `./docs/setup.md`. */
  target: string;
  /** 1-based line number where the reference appears. */
  line: number;
}

/** A fenced-code delimiter opening or closing a block. */
const FENCE_RE = /^\s*(?:```|~~~)/;

/**
 * An `@import`: at the start of a line or after whitespace (so `user@host.com`
 * mid-word is NOT a match), then `@`, then a path token. Emails are excluded by
 * the leading `(?:^|\s)`; fenced/inline code is stripped before this runs.
 */
const IMPORT_RE = /(?:^|\s)@([A-Za-z0-9._~/-]+)/g;

/** Blank out inline `code` spans so an @ inside one isn't read as an import. */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, ' ');
}

/**
 * Extract every `@import` reference, de-duplicated by target (first line kept).
 * References inside fenced code blocks and inline code spans are ignored, as are
 * `@` characters embedded in a word (email addresses). Trailing sentence
 * punctuation is trimmed off the captured target.
 */
export function extractImports(content: string): ImportRef[] {
  const out: ImportRef[] = [];
  const seen = new Set<string>();
  let inFence = false;

  content.split('\n').forEach((raw, index) => {
    if (FENCE_RE.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const line = stripInlineCode(raw);
    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(line)) !== null) {
      const captured = match[1];
      if (captured === undefined) continue;
      const target = captured.replace(/[.,;:)\]}]+$/, '');
      if (target === '' || seen.has(target)) continue;
      seen.add(target);
      out.push({ target, line: index + 1 });
    }
  });

  return out;
}

/** Collapse `.` / `..` / empty segments into a normalized relative path. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Resolve an import target to an instance-relative path, or `undefined` when it
 * is absolute (`/…`) or home-anchored (`~/…`) and therefore cannot be matched
 * against the instance's relative file set.
 */
export function resolveImport(target: string, fromPath: string): string | undefined {
  if (target.startsWith('/') || target.startsWith('~')) return undefined;
  const slash = fromPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : fromPath.slice(0, slash);
  return normalizePath(dir === '' ? target : `${dir}/${target}`);
}

/**
 * How an import resolves against the instance:
 *  - `present`  — resolves to a file the instance knows about (openable);
 *  - `missing`  — resolves inside the instance but no such file exists (broken);
 *  - `external` — absolute / home path, outside the instance (not openable).
 */
export type ImportStatus = 'present' | 'missing' | 'external';

/** An import reference classified for the UI. */
export interface ResolvedImport extends ImportRef {
  /** Instance-relative path (present/missing only). */
  resolved?: string;
  status: ImportStatus;
}

/** Classify each import against the set of known instance file paths. */
export function resolveImports(
  refs: readonly ImportRef[],
  fromPath: string,
  known: ReadonlySet<string>,
): ResolvedImport[] {
  return refs.map((ref) => {
    const resolved = resolveImport(ref.target, fromPath);
    if (resolved === undefined) return { ...ref, status: 'external' };
    return { ...ref, resolved, status: known.has(resolved) ? 'present' : 'missing' };
  });
}

// The redaction guard (`hasRedactionMarks`) and the safe Markdown tokenizer
// (`tokenizeMarkdown` / `MarkdownBlock`) moved to lib (`lib/redacted`,
// `lib/markdown`); Instructions.tsx imports them from there directly.
