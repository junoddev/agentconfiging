/**
 * WriteFlow — the presentational half of the reusable write flow (bead
 * agentconfig-wmc.1). Given a {@link WriteFlowController} (from `useWriteFlow`),
 * it renders the mandatory diff preview (one DiffPanel per edit) and the
 * commit/discard controls, plus terse in-panel status for every phase. Editors
 * (wmc.2-10) can render this directly or drive the controller themselves.
 *
 * GLOBAL-SCOPE WARNING (bead 71h.10): when any pending preview's pathScope is
 * 'global' the diff step carries an unmissable warn Notice — the edit lands in
 * ~/.claude-style config and affects ALL projects and agents on this machine —
 * and the commit button reads "Commit — all projects". One implementation
 * here; every page that renders WriteFlow inherits it.
 *
 * All diff content is already parsed to hunks and rendered by DiffPanel as text
 * nodes only — never markup. This component adds no dangerouslySetInnerHTML.
 */

import { Button, DiffPanel, Notice } from '../components/core/index.js';
import { homeRel } from '../lib/format.js';
import type { WriteFlowController } from './useWriteFlow.js';
import './write.css';

export interface WriteFlowProps {
  flow: WriteFlowController;
}

export function WriteFlow({ flow }: WriteFlowProps) {
  const { phase, request, previews, message } = flow;
  if (phase === 'idle') return null;

  const caption = request?.label;
  const globalPreview =
    phase === 'ready' ? previews.find((p) => p.pathScope === 'global') : undefined;

  return (
    <div className="write-flow" role="group" aria-label="write preview">
      {phase === 'loading' && (
        <p className="write-flow__status meta" role="status">
          Building preview …
        </p>
      )}

      {phase === 'ready' &&
        (previews.length === 0 ? (
          <p className="write-flow__status meta" role="status">
            No changes to apply
          </p>
        ) : (
          <>
            {globalPreview !== undefined && (
              <Notice>
                <span role="alert">
                  {`GLOBAL SCOPE — EDITS ${homeRel(globalPreview.path)} · AFFECTS ALL PROJECTS AND AGENTS ON THIS MACHINE`}
                </span>
              </Notice>
            )}
            {previews.map((preview, i) => (
              <DiffPanel
                key={preview.path + String(i)}
                label={preview.path + (preview.willCreate ? ' · new' : '')}
                hunks={preview.hunks}
              />
            ))}
          </>
        ))}

      {phase === 'committing' && (
        <p className="write-flow__status meta" role="status">
          Applying …
        </p>
      )}

      {(phase === 'done' || phase === 'error') && message !== undefined && (
        <p
          className={`write-flow__status mono-data ${
            phase === 'error' ? 'write-flow__status--error' : 'write-flow__status--ok'
          }`}
          role="status"
        >
          {caption !== undefined ? `${caption} — ${message}` : message}
        </p>
      )}

      <div className="write-flow__actions">
        {phase === 'ready' && previews.length > 0 && (
          <Button
            label={globalPreview !== undefined ? 'Commit — all projects' : 'Commit'}
            variant="primary"
            onClick={flow.commit}
          />
        )}
        {(phase === 'ready' || phase === 'loading' || phase === 'error') && (
          <Button label="Discard" variant="destructive" onClick={flow.cancel} />
        )}
        {phase === 'done' && <Button label="Close" onClick={flow.cancel} />}
      </div>
    </div>
  );
}
