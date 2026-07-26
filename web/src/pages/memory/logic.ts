/**
 * Pure logic for the memory browser & editor (bead agentconfig-wmc.7). DOM-free
 * and React-free so the load-bearing rules are unit-testable over plain data;
 * Memory.tsx is a thin renderer over these helpers.
 *
 * Jobs:
 *   1. Discover the instance's memory files from the report (paths under a
 *      `memory/` directory ending in `.md`).
 *   2. Parse each into a display CARD (type / name / description + body preview)
 *      via the hand-rolled frontmatter reader — malformed input degrades to a
 *      minimal card, never a throw.
 *   3. Serialize the field editor / create form back to file content, and detect
 *      the REDACTION trap (server `spans` OR a `[REDACTED:*]` mark) so a save can
 *      never overwrite a real on-disk secret with the placeholder.
 *
 * All input (report paths, frontmatter, bodies) is UNTRUSTED config data: values
 * only ever become plain strings, and the page renders them as text nodes.
 */

import type { FileContent, Report } from '../../api/types.js';
import { emitScalar, parseScalars, splitFrontmatter } from './frontmatter.js';

/** The frontmatter `type` values SPEC §5 row 5 gives a dedicated badge colour.
 *  Any other value (e.g. the fixtures' `context` / `decision`, or none) still
 *  renders — with the neutral badge — so discovery is never lossy. */
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Last path segment. */
export function basename(path: string): string {
  const slash = path.replace(/\\/g, '/').lastIndexOf('/');
  return slash === -1 ? path : path.replace(/\\/g, '/').slice(slash + 1);
}

const MEMORY_RE = /(?:^|\/)memory\/[^/]+\.md$/i;

/** True when a path is a memory file: a `.md` directly inside a `memory/` dir
 *  (covers `.claude/memory/…` and `~/.claude/projects/<slug>/memory/…`). */
export function isMemoryFile(path: string): boolean {
  return MEMORY_RE.test(path.replace(/\\/g, '/'));
}

/** Display name for a memory file — its basename without the `.md` suffix. */
export function memoryName(path: string): string {
  return basename(path).replace(/\.md$/i, '');
}

/** Every memory file referenced by any detected agent, de-duplicated by path
 *  and deterministically sorted (so the grid never jitters on refetch). */
export function collectMemoryFiles(report: Report | undefined): string[] {
  const set = new Set<string>();
  for (const agent of report?.agents ?? []) {
    for (const file of agent.files) if (isMemoryFile(file)) set.add(file);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ── Redaction trap ───────────────────────────────────────────────────────────

/** Matches a server-inserted `[REDACTED:*]` placeholder mark. */
const REDACTION_RE = /\[REDACTED:[^\]]*\]/;

/** True when text carries a `[REDACTED:*]` mark. */
export function hasRedactionMarks(content: string): boolean {
  return REDACTION_RE.test(content);
}

/**
 * A file is redacted when the server marked `spans` OR its content still carries
 * a `[REDACTED:*]` placeholder. BOTH signals are checked: memory notes can quote
 * secrets, and saving the redacted text would overwrite the real value on disk
 * with the placeholder. Redacted files are shown read-only.
 */
export function isRedacted(file: Pick<FileContent, 'content' | 'spans'>): boolean {
  return file.spans.length > 0 || hasRedactionMarks(file.content);
}

// ── Fields (editor / create form) ────────────────────────────────────────────

/** The editable shape of a memory file: three edited frontmatter scalars, the
 *  body, and any OTHER frontmatter keys preserved verbatim (in order) so a save
 *  never silently drops unmodeled keys like `author`/`tags`/`created`. */
export interface MemoryFields {
  type: string;
  name: string;
  description: string;
  body: string;
  /** Unmodeled frontmatter keys, in original order, round-tripped on save. */
  extra: Array<{ key: string; value: string }>;
}

const EDITED_KEYS = new Set(['type', 'name', 'description']);

/** Parse file content into editable fields. Missing frontmatter or any missing
 *  field degrades to an empty string for that field; the body is trimmed so the
 *  serialize round-trip is stable. Frontmatter keys other than type/name/
 *  description are preserved in `extra` (original order) so they survive a save. */
export function parseMemory(content: string): MemoryFields {
  const { frontmatter, body } = splitFrontmatter(content);
  const fields = frontmatter === null ? {} : parseScalars(frontmatter);
  const extra = Object.entries(fields)
    .filter(([key]) => !EDITED_KEYS.has(key))
    .map(([key, value]) => ({ key, value }));
  return {
    type: fields.type ?? '',
    name: fields.name ?? '',
    description: fields.description ?? '',
    body: body.trim(),
    extra,
  };
}

/**
 * Serialize fields back to canonical memory-file content: a `type / name /
 * description` frontmatter block (values quoted only when needed), then any
 * preserved `extra` keys in order, followed by a blank line and the trimmed
 * body. `parseMemory(serializeMemory(f))` returns `f` for any fields whose body
 * is already trimmed.
 */
export function serializeMemory(fields: MemoryFields): string {
  const block = [
    '---',
    emitScalar('type', fields.type),
    emitScalar('name', fields.name),
    emitScalar('description', fields.description),
    ...(fields.extra ?? []).map((e) => emitScalar(e.key, e.value)),
    '---',
  ].join('\n');
  const body = fields.body.trim();
  return body === '' ? `${block}\n` : `${block}\n\n${body}\n`;
}

// ── Cards (grid) ─────────────────────────────────────────────────────────────

/** One memory card for the grid. `redacted` cards still render (name + badge)
 *  but their editor is read-only. */
export interface MemoryCard {
  path: string;
  /** Frontmatter `name`, or the file basename when absent. */
  name: string;
  /** Frontmatter `type` (may be ''); the badge colours the known values. */
  type: string;
  description: string;
  /** First substantive body line, truncated — a one-line grid teaser. */
  preview: string;
  redacted: boolean;
}

/** First non-blank body line that is not a heading or code fence, trimmed and
 *  truncated to `max` chars with an ellipsis. Empty when the body is only
 *  structure. */
export function bodyPreview(body: string, max = 140): string {
  let inFence = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence; // enter/leave a fenced block (its content is skipped)
      continue;
    }
    if (inFence || line === '' || line.startsWith('#')) continue;
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return '';
}

/** Build a display card from a loaded (already-redacted) file. */
export function buildCard(path: string, file: Pick<FileContent, 'content' | 'spans'>): MemoryCard {
  const { type, name, description, body } = parseMemory(file.content);
  return {
    path,
    name: name.trim() || memoryName(path),
    type: type.trim(),
    description,
    preview: bodyPreview(body),
    redacted: isRedacted(file),
  };
}

// ── Create flow ──────────────────────────────────────────────────────────────

/** Lowercase, hyphenate, and strip to a filesystem-safe slug (empty → 'note'). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'note' : slug;
}

/** Suggested report-relative path for a new memory file, from its name. */
export function suggestPath(name: string): string {
  return `.claude/memory/${slugify(name)}.md`;
}
