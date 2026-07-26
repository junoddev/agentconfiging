/**
 * Instruction-sync engine (SPEC §4.1, E5 — bead agentconfig-wmc.10).
 *
 * A PURE, fixture-testable transformation between runtimes' instruction formats.
 * The user designates a SOURCE OF TRUTH (e.g. CLAUDE.md) and this regenerates
 * the other runtimes' instruction files from it. Zero I/O: `syncPlan(source,
 * targets)` maps content in → per-target `{path, content}` out; the server layer
 * diffs those against disk and writes through the ONE guarded write path.
 *
 * FORMAT-MAPPING DECISIONS (bidirectional, documented; approximations flagged
 * `lossy` on the entry):
 *
 *  1. BODY is preserved verbatim. The source's instruction body is the user's
 *     content and is copied faithfully — the engine never rewrites, reflows, or
 *     summarizes it. The only normalization is stripping a leading blank line
 *     left by frontmatter removal and guaranteeing a single trailing newline.
 *
 *  2. SOURCE frontmatter is DETECTED and STRIPPED. Whether the source is plain
 *     markdown (CLAUDE.md/AGENTS.md/GEMINI.md) or a frontmattered rule
 *     (.cursor/rules/*.mdc), only its body flows to the targets. Frontmatter is
 *     per-runtime metadata, not portable instruction content.
 *
 *  3. plain-markdown TARGET (most runtimes): content = body, as-is. A near-copy.
 *     Not lossy.
 *
 *  4. frontmattered-markdown TARGET (Cursor `.mdc`, Continue): a MINIMAL
 *     frontmatter block is synthesized ahead of the body — Cursor gets
 *     `description` + `alwaysApply: true` (the faithful equivalent of an
 *     always-on guide); Continue gets `name`. The `description`/`name` is drawn
 *     from the source's first H1 when present, else a neutral default. Marked
 *     LOSSY: metadata is invented, not carried from the source.
 *
 *  5. single-file → rules-dir / hybrid TARGET (Amazon Q, Roo, …): the whole
 *     guide is written as ONE primary rule file (the runtime's `scaffoldPath`).
 *     Marked LOSSY with a note — a multi-rule directory is collapsed to a single
 *     file, which is the safe, reversible choice.
 *
 * The engine writes each runtime's PRIMARY instruction file only (its preferred
 * modern location), chosen by {@link targetPath}. Runtimes that share a file
 * (Codex + opencode → AGENTS.md) collapse to one plan entry listing both.
 */

import { firstHeadingOf, parseFrontmatter } from '../parsers/index.js';
import type { RuntimeFormat } from '../runtimes/types.js';
import type { SyncPlanEntry, SyncSource, SyncStatus } from './types.js';

/**
 * The single concrete file the engine writes for a runtime. When the preferred
 * instruction location is a rules DIRECTORY (trailing '/'), the runtime's
 * `scaffoldPath` (a starter rule file inside that dir) is the target; otherwise
 * it is the preferred single file itself.
 */
export function targetPath(rt: RuntimeFormat): string {
  const first = rt.instructionPaths[0];
  if (first !== undefined && first.endsWith('/')) return rt.scaffoldPath;
  return first ?? rt.scaffoldPath;
}

/** Extract the portable instruction body from a source file (frontmatter stripped). */
function sourceBody(content: string): string {
  const fm = parseFrontmatter(content);
  // Drop the blank line frontmatter removal leaves behind; keep the rest verbatim.
  const body = fm.hasFrontmatter ? fm.body.replace(/^\n+/, '') : content;
  return body.endsWith('\n') ? body : `${body}\n`;
}

/**
 * A single-line, YAML-safe description drawn from the source title. Strips
 * characters that would break the tiny `key: value` frontmatter we emit
 * (colons, `#`, quotes, backticks, newlines) and caps the length. Returns
 * undefined when nothing usable remains.
 */
function safeDescription(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const clean = title
    .replace(/[:#"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return clean.length > 0 ? clean : undefined;
}

/** The synthesized frontmatter block (with trailing blank line) for a target, or ''. */
function frontmatterFor(rt: RuntimeFormat, title: string | undefined): string {
  if (rt.format !== 'frontmattered-markdown') return '';
  const desc = safeDescription(title) ?? 'Project conventions';
  // Continue keys its rule frontmatter on `name`; Cursor (and any other
  // frontmattered runtime) on `description` + an always-apply flag so the guide
  // behaves like the always-on instruction file it was synced from.
  if (rt.id === 'continue') return `---\nname: ${desc}\n---\n\n`;
  return `---\ndescription: ${desc}\nalwaysApply: true\n---\n\n`;
}

/** Whether a target's mapping is approximate, and a short human note if so. */
function lossiness(
  rt: RuntimeFormat,
  sourceHadFrontmatter: boolean,
): { lossy: boolean; note?: string } {
  const notes: string[] = [];
  if (rt.format === 'frontmattered-markdown') notes.push('frontmatter synthesized');
  const first = rt.instructionPaths[0];
  if (first !== undefined && first.endsWith('/')) notes.push('written as one rule file');
  if (sourceHadFrontmatter && rt.format === 'markdown') notes.push('source frontmatter dropped');
  return notes.length > 0 ? { lossy: true, note: notes.join(' · ') } : { lossy: false };
}

function byPath(a: SyncPlanEntry, b: SyncPlanEntry): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Plan the regeneration of every `target` runtime's primary instruction file
 * from `source`. Pure: content in → plan out, zero I/O. Entries are keyed by
 * PATH (shared-file runtimes collapse) and returned sorted by path. A target
 * whose path equals the source path is skipped (never regenerate the source).
 */
export function syncPlan(source: SyncSource, targets: readonly RuntimeFormat[]): SyncPlanEntry[] {
  const hadFrontmatter = parseFrontmatter(source.content).hasFrontmatter;
  const body = sourceBody(source.content);
  const title = firstHeadingOf(body);

  const byTarget = new Map<string, SyncPlanEntry>();
  for (const rt of targets) {
    const path = targetPath(rt);
    if (path === source.path) continue;
    const existing = byTarget.get(path);
    if (existing) {
      existing.runtimeIds.push(rt.id);
      existing.displayNames.push(rt.displayName);
      continue;
    }
    const { lossy, note } = lossiness(rt, hadFrontmatter);
    const entry: SyncPlanEntry = {
      path,
      content: frontmatterFor(rt, title) + body,
      format: rt.format,
      layout: rt.layout,
      runtimeIds: [rt.id],
      displayNames: [rt.displayName],
      lossy,
    };
    if (note !== undefined) entry.note = note;
    byTarget.set(path, entry);
  }

  const entries = [...byTarget.values()];
  for (const entry of entries) {
    entry.runtimeIds.sort();
    entry.displayNames.sort();
  }
  return entries.sort(byPath);
}

/**
 * Freshness of a planned target against its current on-disk content. Pure — the
 * caller supplies `existing` (undefined when the file is absent). An exact match
 * is `in-sync`; any difference is `changed`.
 */
export function syncStatus(generated: string, existing: string | undefined): SyncStatus {
  if (existing === undefined) return 'new';
  return existing === generated ? 'in-sync' : 'changed';
}
