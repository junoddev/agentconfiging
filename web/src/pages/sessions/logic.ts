/**
 * Session replay page — pure logic (bead 7yb.3). DOM-free and React-free so the
 * redacted-content segmentation, markdown export, and small formatters are
 * unit-testable in isolation; Sessions.tsx stays a thin render.
 *
 * Everything here consumes ALREADY-REDACTED server data: `text` fields carry
 * `[REDACTED:*]` marks, never raw secrets. The markdown export therefore emits
 * only redacted content — a raw secret can never appear in an export. All
 * content is treated as opaque text: this module never interprets or executes
 * it, and the renderer maps segments to TEXT NODES only.
 */

import type {
  RedactionSpan,
  ReplayBlock,
  ReplayMessage,
  SessionDetail,
  SessionSummary,
} from '../../api/types.js';

/** One run of the redacted text — a plain slice or a `[REDACTED:*]` mark. */
export interface RedactSegment {
  text: string;
  redacted: boolean;
  /** Catalogue pattern id, present only on a redacted segment. */
  id?: string;
}

/**
 * Split redacted `content` + mark `spans` into ordered segments the renderer
 * turns into text nodes (plain) or styled `<mark>` nodes (redacted). Defensive:
 * out-of-range / overlapping / inverted spans are skipped, and any tail after
 * the last span is preserved. No secret is present (redaction is server-side),
 * so this is purely a styling split.
 */
export function renderSegments(content: string, spans: readonly RedactionSpan[]): RedactSegment[] {
  const segments: RedactSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor || span.end > content.length || span.start >= span.end) continue;
    if (span.start > cursor)
      segments.push({ text: content.slice(cursor, span.start), redacted: false });
    segments.push({ text: content.slice(span.start, span.end), redacted: true, id: span.id });
    cursor = span.end;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), redacted: false });
  return segments;
}

/** A short kind label for a replay block card header. */
export function blockLabel(block: ReplayBlock): string {
  switch (block.kind) {
    case 'text':
      return 'text';
    case 'thinking':
      return 'thinking';
    case 'tool_use':
      return block.name !== undefined && block.name !== '' ? `tool · ${block.name}` : 'tool';
    case 'tool_result':
      return 'tool result';
    default:
      return block.blockType !== undefined && block.blockType !== '' ? block.blockType : 'unknown';
  }
}

/** A short role label for a message card (subagent / meta annotated). */
export function messageLabel(message: ReplayMessage): string {
  const parts: string[] = [message.role];
  if (message.isSidechain) parts.push('subagent');
  if (message.isMeta) parts.push('meta');
  return parts.join(' · ');
}

/** ms → a terse `1h 02m` / `3m 20s` / `12s` duration, or '' for undefined. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** ISO → a compact local `YYYY-MM-DD HH:MM`, or '' when unparseable/absent. */
export function formatWhen(iso: string | undefined): string {
  if (iso === undefined) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Normalize a single tag the way the server will (trim, bound length). */
export function normalizeTag(raw: string): string {
  return raw.trim().slice(0, 64);
}

/** A terse mono table id — the first 8 chars of the (often UUID) session id. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Case-insensitive substring filter over id + title + cwd + tags for the
 * browse table's `.search` (Console §7: the empty state names this query).
 * A blank query matches everything. Never mutates the input.
 */
export function filterSessions(
  sessions: readonly SessionSummary[],
  query: string,
): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...sessions];
  return sessions.filter((s) =>
    [s.id, s.title, s.cwd, ...s.tags].join(' ').toLowerCase().includes(q),
  );
}

function blockToMarkdown(block: ReplayBlock): string {
  switch (block.kind) {
    case 'text':
      return block.text ?? '';
    case 'thinking': {
      const body = (block.text ?? '')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
      return `_thinking_\n\n${body}`;
    }
    case 'tool_use':
      return `**tool_use** \`${block.name ?? ''}\``;
    case 'tool_result': {
      const fence = ['```', block.text ?? '', '```'].join('\n');
      return block.persistedOutputPath !== undefined
        ? `${fence}\n\n_spilled → ${block.persistedOutputPath}_`
        : fence;
    }
    default:
      return `_(${block.blockType ?? 'unknown'} block)_`;
  }
}

/**
 * Client-side markdown export of the (already-redacted) loaded session window.
 * Redacted content ONLY — the marks are exported verbatim, so no raw secret can
 * leave the browser. When the session is windowed, the range is annotated so the
 * export is honest about being partial.
 */
export function sessionToMarkdown(detail: SessionDetail): string {
  const out: string[] = [];
  out.push(`# ${detail.title !== '' ? detail.title : detail.id}`);
  out.push('');

  const meta: string[] = [`id: ${detail.id}`, `runtime: ${detail.runtime}`];
  if (detail.cwd !== '') meta.push(`cwd: ${detail.cwd}`);
  if (detail.startedAt !== undefined) meta.push(`started: ${detail.startedAt}`);
  if (detail.endedAt !== undefined) meta.push(`ended: ${detail.endedAt}`);
  meta.push(`messages: ${detail.messageCount}`);
  if (detail.tags.length > 0) meta.push(`tags: ${detail.tags.join(', ')}`);
  out.push(meta.map((m) => `- ${m}`).join('\n'));
  out.push('');

  const shown = detail.messages.length;
  const windowed = shown < detail.messageCount;
  const range = windowed
    ? `messages ${detail.offset + 1}–${detail.offset + shown} of ${detail.messageCount}`
    : `all ${detail.messageCount} messages`;
  out.push(`> Redacted export (secrets shown as \`[REDACTED:*]\`) — ${range}.`);

  for (const message of detail.messages) {
    out.push('');
    const when = message.timestamp !== undefined ? ` — ${message.timestamp}` : '';
    out.push(`## ${messageLabel(message)}${when}`);
    for (const block of message.blocks) {
      out.push('');
      out.push(blockToMarkdown(block));
    }
  }
  return `${out.join('\n')}\n`;
}
