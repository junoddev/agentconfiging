/**
 * Shared redaction UI + guard (extracted from Instructions / Rules / Memory /
 * Artifacts, which each carried a private copy — the migration wave points them
 * here).
 *
 * The REDACTION-SAVE TRAP (SPEC §3): GET /api/file returns REDACTED text — real
 * secrets are replaced server-side by visible `[REDACTED:*]` marks, and `spans`
 * locate each mark. Saving that text back would overwrite the real secret on
 * disk with the placeholder, so a file flagged redacted (server `spans` OR a
 * `[REDACTED:*]` mark in the served text) is shown READ-ONLY. Both signals are
 * checked belt-and-braces.
 *
 * All content here is adversarial config: it only ever becomes TEXT nodes —
 * never markup, never `dangerouslySetInnerHTML`. Marks are already redacted
 * server-side, so no secret is present to leak.
 */

import type { ReactNode } from 'react';
import type { FileContent, RedactionSpan } from '../api/index.js';

/** Matches a server-inserted `[REDACTED:*]` placeholder mark. */
export const REDACTION_RE = /\[REDACTED:[^\]]*\]/;

/**
 * True when text carries a `[REDACTED:*]` mark. Use this on raw text (e.g. a
 * snippet or a value that has no `spans` alongside it). For a served file with
 * `spans`, prefer {@link isRedactedFile}, which also honours the server flag.
 */
export function hasRedactionMarks(text: string): boolean {
  return REDACTION_RE.test(text);
}

/**
 * True when a served file must be READ-ONLY: the server marked redaction `spans`
 * OR its `content` still carries a `[REDACTED:*]` mark. This is the single,
 * canonical guard replacing the previously divergent per-page `isRedacted`
 * signatures — callers pass the loaded {@link FileContent} (only `content` and
 * `spans` are read).
 */
export function isRedactedFile(file: Pick<FileContent, 'content' | 'spans'>): boolean {
  return file.spans.length > 0 || hasRedactionMarks(file.content);
}

/**
 * Redacted `content` + its mark `spans` → React nodes: verbatim text interleaved
 * with styled `[REDACTED:*]` marks. Everything is a TEXT node — never markup —
 * and marks are already redacted server-side, so no secret is present to leak.
 * Spans are trusted to be sorted and non-overlapping (the server contract); a
 * defensive skip guards a malformed span anyway.
 *
 * `markClassName` styles the `<mark>` wrapper — defaults to `redact-mark` (the
 * Instructions / Rules / Memory class); Artifacts passes `artifact__redact`.
 */
export function renderRedacted(
  content: string,
  spans: readonly RedactionSpan[],
  markClassName = 'redact-mark',
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start < cursor || span.end > content.length) return;
    if (span.start > cursor) nodes.push(content.slice(cursor, span.start));
    nodes.push(
      <mark key={i} className={markClassName} title={`redacted: ${span.id}`}>
        {content.slice(span.start, span.end)}
      </mark>,
    );
    cursor = span.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}
