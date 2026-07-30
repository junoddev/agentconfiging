/**
 * RUN HISTORY + REPLAY panel (bead ira.3). Lists a pipeline's past runs (time,
 * status, duration, per-node status counts) and — on selecting one — a REPLAY
 * view that steps through the run's recorded per-node status + output. A re-run
 * button fires the pipeline again through the COMMITTED guarded run route (this
 * panel never runs anything itself).
 *
 * SECURITY: every value shown is server-REDACTED (a node's `output.text` carries
 * `[REDACTED:*]` marks, never a raw secret — secret-never-on-wire, like session
 * replay) and rendered as a TEXT NODE only, never markup.
 */

import { useEffect, useState } from 'react';
import type { RedactionSpan, RunHistoryEntry, RunSnapshot } from '../../api/types.js';
import { Button, EmptyState } from '../../components/core/index.js';
import {
  clampStep,
  formatClock,
  formatDuration,
  renderSegments,
  replaySteps,
  runStatusModifier,
  statusCountsLabel,
} from './history.js';

/** Redacted `text` + `spans` → text nodes with styled `[REDACTED:*]` marks. The
 *  content is already redacted server-side, so no secret is present to leak. */
function RedactedText({ text, spans }: { text: string; spans: readonly RedactionSpan[] }) {
  const segments = renderSegments(text, spans);
  return (
    <>
      {segments.map((seg, i) =>
        seg.redacted ? (
          <mark key={i} className="pipeline-redact" title={`redacted: ${seg.id ?? ''}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export interface RunHistoryProps {
  /** The most-recent runs for the selected pipeline (newest first). */
  runs: RunHistoryEntry[];
  /** The run whose replay detail is loaded (matches `selectedRunId`). */
  replay?: RunSnapshot;
  selectedRunId?: string;
  loading: boolean;
  /** True once the current graph is saved server-side (history keys off its id). */
  canRerun: boolean;
  onSelect: (runId: string) => void;
  onRerun: () => void;
}

export function RunHistory({
  runs,
  replay,
  selectedRunId,
  loading,
  canRerun,
  onSelect,
  onRerun,
}: RunHistoryProps) {
  const steps = replaySteps(replay);
  const [step, setStep] = useState(0);

  // Reset the stepper whenever a different run is opened.
  useEffect(() => {
    setStep(0);
  }, [selectedRunId]);

  const current = clampStep(step, steps.length);

  return (
    <div className="pipeline-history">
      <div className="pipeline-history__head">
        <span className="micro-label">RUN HISTORY</span>
        <Button label="Re-run" disabled={!canRerun} onClick={onRerun} />
      </div>

      {loading ? (
        <span className="meta">loading…</span>
      ) : runs.length === 0 ? (
        <EmptyState title="No runs yet" instruction="run this pipeline to record its first run" />
      ) : (
        <ul className="pipeline-history__list">
          {runs.map((entry) => (
            <li key={entry.runId}>
              <button
                type="button"
                className={`pipeline-history__row ${runStatusModifier(entry.status)} ${
                  entry.runId === selectedRunId ? 'pipeline-history__row--active' : ''
                }`}
                onClick={() => onSelect(entry.runId)}
              >
                <span className="pipeline-history__when mono-data">
                  {formatClock(entry.startedAt)}
                </span>
                <span className="pipeline-history__status micro-label">{entry.status}</span>
                <span className="pipeline-history__meta micro-label">
                  {statusCountsLabel(entry.counts)}
                  {entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedRunId !== undefined && steps.length > 0 && current >= 0 && (
        <div className="pipeline-replay">
          <div className="pipeline-replay__head">
            <span className="micro-label">REPLAY</span>
            <div className="pipeline-replay__nav">
              <Button label="‹" disabled={current <= 0} onClick={() => setStep(current - 1)} />
              <span className="micro-label pipeline-replay__count">
                {current + 1}/{steps.length}
              </span>
              <Button
                label="›"
                disabled={current >= steps.length - 1}
                onClick={() => setStep(current + 1)}
              />
            </div>
          </div>
          {(() => {
            const node = steps[current]!;
            return (
              <div className={`pipeline-replay__node pipeline-node--${node.status}`}>
                <div className="pipeline-replay__node-head">
                  <span className="pipeline-replay__name mono-data">{node.nodeName}</span>
                  <span className="pipeline-replay__node-status micro-label">{node.status}</span>
                </div>
                {node.error !== undefined && node.error !== '' && (
                  <pre className="mono-data pipeline-replay__error">{node.error}</pre>
                )}
                <pre className="mono-data pipeline-replay__output">
                  {node.outputText === '' ? (
                    <span className="pipeline-history__note">no output</span>
                  ) : (
                    <RedactedText text={node.outputText} spans={node.outputSpans} />
                  )}
                </pre>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
