/**
 * Session-search page — pure logic (bead 7yb.4). DOM-free and React-free so the
 * redacted-snippet segmentation, the replay deep-link, and the small formatters
 * are unit-testable in isolation; Search.tsx stays a thin render.
 *
 * Every input is ALREADY-REDACTED server data: `snippet` carries `[REDACTED:*]`
 * marks, never raw secrets. This module never interprets content; the renderer
 * maps segments to TEXT NODES only.
 */

import type { RedactionSpan, SearchHit } from '../../api/types.js';

/** One run of a redacted snippet — a plain slice or a `[REDACTED:*]` mark. */
export interface SnippetSegment {
  text: string;
  redacted: boolean;
  id?: string;
}

/**
 * Split a redacted `snippet` + mark `spans` into ordered segments the renderer
 * turns into text nodes (plain) or styled `<mark>` nodes (redacted). Defensive:
 * out-of-range / overlapping / inverted spans are skipped, and any tail after the
 * last span is preserved. No secret is present (redaction is server-side).
 */
export function snippetSegments(
  snippet: string,
  spans: readonly RedactionSpan[],
): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor || span.end > snippet.length || span.start >= span.end) continue;
    if (span.start > cursor)
      segments.push({ text: snippet.slice(cursor, span.start), redacted: false });
    segments.push({ text: snippet.slice(span.start, span.end), redacted: true, id: span.id });
    cursor = span.end;
  }
  if (cursor < snippet.length) segments.push({ text: snippet.slice(cursor), redacted: false });
  return segments;
}

/** Deep link to a hit's session in the replay page (rail 18 SESSIONS). The id is
 *  opaque log text — encoded so it can never break the hash. */
export function sessionRefHash(hit: Pick<SearchHit, 'sessionId'>): string {
  return `#/sessions?session=${encodeURIComponent(hit.sessionId)}`;
}

/** A short label for one hit's provenance (role · message #n). */
export function hitLabel(hit: Pick<SearchHit, 'role' | 'messageIndex'>): string {
  const role = hit.role !== '' ? hit.role : 'message';
  return `${role} · #${hit.messageIndex + 1}`;
}

/** A one-line coverage summary for the status bar, e.g. "42 of 60 sessions · 1,204 messages". */
export function coverageLine(
  indexed: { sessions: number; messages: number },
  total: number,
): string {
  const sessions = `${indexed.sessions.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} sessions`;
  const messages = `${indexed.messages.toLocaleString('en-US')} messages indexed`;
  return `${sessions} · ${messages}`;
}

/** ISO → a compact local `YYYY-MM-DD HH:MM`, or '' when unparseable/absent. */
export function formatWhen(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
