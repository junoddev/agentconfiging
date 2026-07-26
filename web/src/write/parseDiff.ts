/**
 * parseDiff — turn the server's unified-diff TEXT (src/server/diff.ts) into the
 * `DiffHunk[]` model DiffPanel renders. DOM-free and pure so it is unit-testable
 * and reusable by every editor's save flow (wmc.2-10).
 *
 * The server emits standard unified diff: `--- ` / `+++ ` file headers, then one
 * or more `@@ … @@` hunks whose body lines are prefixed ` ` (context), `+`
 * (added) or `-` (removed). We drop the file headers, open a hunk on each `@@`,
 * and classify each body line. Every character after the 1-column marker is kept
 * verbatim — DiffPanel renders it as a text node, never markup.
 */

import type { DiffHunk, DiffLine } from '../components/core/index.js';

export function parseDiff(text: string): DiffHunk[] {
  const hunks: { header: string; lines: DiffLine[] }[] = [];
  let current: { header: string; lines: DiffLine[] } | undefined;

  for (const raw of text.split('\n')) {
    // The trailing newline the server appends yields one final empty element;
    // a genuine blank CONTEXT line arrives as ' ' (space + empty), never ''.
    if (raw === '') continue;
    if (raw.startsWith('@@')) {
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    // Preamble before the first hunk (the --- / +++ file headers) is skipped.
    if (!current) continue;
    const marker = raw[0];
    const body = raw.slice(1);
    if (marker === '+') current.lines.push({ kind: 'add', text: body });
    else if (marker === '-') current.lines.push({ kind: 'del', text: body });
    else current.lines.push({ kind: 'ctx', text: body });
  }

  return hunks;
}
