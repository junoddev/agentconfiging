/**
 * Pure logic for the pipeline RUN HISTORY + REPLAY surface (bead ira.3). DOM-free
 * + React-free so the load-bearing behaviour — run-list formatting, the replay
 * stepper's node ordering, status labels, and the redacted-output segmentation —
 * is unit-testable over plain values. RunHistory.tsx is a thin renderer over
 * these helpers.
 *
 * Everything here consumes ALREADY-REDACTED server data: a run's per-node
 * `output.text` carries `[REDACTED:*]` marks, never a raw secret (redaction is
 * server-side, SPEC §3). These functions only slice/label plain values — nothing
 * produces markup; callers render every field as a text node.
 */

import type {
  RedactionSpan,
  RunHistoryEntry,
  RunNodeState,
  RunNodeStatus,
  RunSnapshot,
  RunStatusCounts,
} from '../../api/types.js';

/** One run of a redacted text field — a plain slice or a `[REDACTED:*]` mark. */
export interface RedactSegment {
  text: string;
  redacted: boolean;
  /** Catalogue pattern id, present only on a redacted segment. */
  id?: string;
}

/**
 * Split a redacted `content` + its mark `spans` into ordered segments the
 * renderer turns into text nodes (plain) or styled `<mark>` nodes (redacted).
 * Defensive: out-of-range / overlapping / inverted spans are skipped and any
 * tail after the last span is preserved. No secret is present (redaction is
 * server-side), so this is purely a styling split.
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

/** ms → a terse run duration: `820ms`, `1.2s`, `1m 05s`. '' for undefined/invalid. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** epoch ms → a local wall-clock label for a run row (locale-formatted). */
export function formatClock(startedAt: number): string {
  if (!Number.isFinite(startedAt)) return '';
  return new Date(startedAt).toLocaleString();
}

/** Per-node status counts → a terse label, e.g. `3 ok · 1 error`. Zero-count
 *  categories are omitted; `—` when there are no nodes yet. */
export function statusCountsLabel(counts: RunStatusCounts): string {
  const order: RunNodeStatus[] = ['ok', 'error', 'running', 'pending'];
  const parts = order.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${k}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/** A whole-run status → its CSS modifier suffix (reuses the run-badge palette). */
export function runStatusModifier(status: RunHistoryEntry['status']): string {
  return `pipeline-run--${status}`;
}

/** One step of a replay: a node's recorded state, in execution order. */
export interface ReplayStep {
  id: string;
  nodeName: string;
  status: RunNodeStatus;
  /** Redacted output text (already secret-free), or '' when the node had none. */
  outputText: string;
  outputSpans: RedactionSpan[];
  error?: string;
}

/**
 * A run snapshot → its replay steps, in the order nodes first appeared in the
 * record (the executor emits per-node events in execution order, so insertion
 * order is execution order). Pure — the stepper walks this array.
 */
export function replaySteps(run: RunSnapshot | undefined): ReplayStep[] {
  if (!run) return [];
  return Object.entries(run.nodes).map(([id, state]: [string, RunNodeState]) => {
    const step: ReplayStep = {
      id,
      nodeName: state.nodeName,
      status: state.status,
      outputText: state.output?.text ?? '',
      outputSpans: state.output?.spans ?? [],
    };
    if (state.error !== undefined) step.error = state.error;
    return step;
  });
}

/** Clamp a stepper index into `[0, count)` (or -1 when there are no steps). */
export function clampStep(index: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}
