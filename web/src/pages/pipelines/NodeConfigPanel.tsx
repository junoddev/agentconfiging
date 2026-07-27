/**
 * The node config side panel (bead ira.2) — edit a selected node's TYPED config.
 * Every field is plain text/number input; the values (bash scripts, urls, paths)
 * are UNTRUSTED but only ever fed back into the pipeline model as data — never
 * rendered as markup, never evaluated. Transform ops are edited as JSON text
 * (the safe declarative form); a parse error leaves the last valid ops in place.
 */

import { useEffect, useState } from 'react';
import type { FilterOp, PipelineNode } from '../../api/types.js';

const GIT_SUBCOMMANDS = ['status', 'log', 'diff', 'show', 'rev-parse', 'describe', 'shortlog'];
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const FILTER_OPS: FilterOp[] = ['eq', 'ne', 'contains', 'gt', 'lt', 'exists'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="pipeline-field">
      <span className="micro-label">{label}</span>
      {children}
    </label>
  );
}

export function NodeConfigPanel({
  node,
  onChange,
  onDelete,
}: {
  node: PipelineNode;
  onChange: (next: PipelineNode) => void;
  onDelete: () => void;
}) {
  // Transform ops are edited as JSON text with local buffer + parse feedback.
  const [opsText, setOpsText] = useState('');
  const [opsError, setOpsError] = useState('');
  useEffect(() => {
    if (node.type === 'transform') setOpsText(JSON.stringify(node.operations, null, 2));
  }, [node]);

  // `set` produces a NEW config object with one field patched (immutable update).
  const set = <T extends PipelineNode>(patch: Partial<T>): void => {
    onChange({ ...(node as T), ...patch });
  };

  return (
    <aside className="pipeline-panel" aria-label="node configuration">
      <div className="pipeline-panel__head">
        <span className="micro-label">{node.type}</span>
        <button className="pipeline-panel__del micro-label" type="button" onClick={onDelete}>
          delete node
        </button>
      </div>

      <Field label="NAME (the {{name}} template key)">
        <input
          className="pipeline-input mono-data"
          value={node.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </Field>

      {node.type === 'prompt' && (
        <>
          <Field label="PROMPT">
            <textarea
              className="pipeline-input mono-data"
              rows={4}
              value={node.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
            />
          </Field>
          <Field label="MODEL (optional)">
            <input
              className="pipeline-input mono-data"
              value={node.model ?? ''}
              onChange={(e) => set({ model: e.target.value })}
            />
          </Field>
        </>
      )}

      {node.type === 'bash' && (
        <Field label="SCRIPT">
          <textarea
            className="pipeline-input mono-data"
            rows={5}
            value={node.script}
            onChange={(e) => set({ script: e.target.value })}
          />
        </Field>
      )}

      {node.type === 'github-action' && (
        <>
          <Field label="WORKFLOW">
            <input
              className="pipeline-input mono-data"
              value={node.workflow}
              onChange={(e) => set({ workflow: e.target.value })}
            />
          </Field>
          <Field label="REF (optional)">
            <input
              className="pipeline-input mono-data"
              value={node.ref ?? ''}
              onChange={(e) => set({ ref: e.target.value })}
            />
          </Field>
        </>
      )}

      {node.type === 'http' && (
        <>
          <Field label="METHOD">
            <select
              className="pipeline-input mono-data"
              value={node.method ?? 'GET'}
              onChange={(e) => set({ method: e.target.value })}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input
              className="pipeline-input mono-data"
              value={node.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </Field>
          <Field label="BODY (optional)">
            <textarea
              className="pipeline-input mono-data"
              rows={3}
              value={node.body ?? ''}
              onChange={(e) => set({ body: e.target.value })}
            />
          </Field>
        </>
      )}

      {node.type === 'transform' && (
        <Field label="OPERATIONS (JSON)">
          <textarea
            className="pipeline-input mono-data"
            rows={6}
            value={opsText}
            onChange={(e) => {
              setOpsText(e.target.value);
              try {
                const parsed = JSON.parse(e.target.value);
                if (Array.isArray(parsed)) {
                  set({ operations: parsed });
                  setOpsError('');
                } else {
                  setOpsError('operations must be a JSON array');
                }
              } catch {
                setOpsError('invalid JSON — last valid ops kept');
              }
            }}
          />
          {opsError !== '' && <span className="pipeline-panel__err micro-label">{opsError}</span>}
        </Field>
      )}

      {node.type === 'delay' && (
        <Field label="MS">
          <input
            className="pipeline-input mono-data"
            type="number"
            value={node.ms}
            onChange={(e) => set({ ms: Number(e.target.value) })}
          />
        </Field>
      )}

      {node.type === 'git' && (
        <>
          <Field label="SUBCOMMAND">
            <select
              className="pipeline-input mono-data"
              value={node.subcommand}
              onChange={(e) => set({ subcommand: e.target.value })}
            >
              {GIT_SUBCOMMANDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ARGS (comma-separated)">
            <input
              className="pipeline-input mono-data"
              value={(node.args ?? []).join(', ')}
              onChange={(e) =>
                set({
                  args: e.target.value
                    .split(',')
                    .map((a) => a.trim())
                    .filter((a) => a !== ''),
                })
              }
            />
          </Field>
        </>
      )}

      {node.type === 'filter' && (
        <>
          <Field label="FIELD">
            <input
              className="pipeline-input mono-data"
              value={node.predicate.field}
              onChange={(e) => set({ predicate: { ...node.predicate, field: e.target.value } })}
            />
          </Field>
          <Field label="OP">
            <select
              className="pipeline-input mono-data"
              value={node.predicate.op}
              onChange={(e) =>
                set({ predicate: { ...node.predicate, op: e.target.value as FilterOp } })
              }
            >
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
          {node.predicate.op !== 'exists' && (
            <Field label="VALUE">
              <input
                className="pipeline-input mono-data"
                value={String(node.predicate.value ?? '')}
                onChange={(e) => set({ predicate: { ...node.predicate, value: e.target.value } })}
              />
            </Field>
          )}
        </>
      )}

      {(node.type === 'read-file' || node.type === 'json-extract') && (
        <Field label="PATH">
          <input
            className="pipeline-input mono-data"
            value={node.path}
            onChange={(e) => set({ path: e.target.value })}
          />
        </Field>
      )}

      {node.type === 'write-file' && (
        <>
          <Field label="PATH">
            <input
              className="pipeline-input mono-data"
              value={node.path}
              onChange={(e) => set({ path: e.target.value })}
            />
          </Field>
          <Field label="CONTENT">
            <textarea
              className="pipeline-input mono-data"
              rows={4}
              value={node.content}
              onChange={(e) => set({ content: e.target.value })}
            />
          </Field>
        </>
      )}

      {node.type === 'notification' && (
        <>
          <Field label="MESSAGE">
            <input
              className="pipeline-input mono-data"
              value={node.message}
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
          <Field label="LEVEL">
            <select
              className="pipeline-input mono-data"
              value={node.level ?? 'info'}
              onChange={(e) => set({ level: e.target.value as 'info' | 'warn' | 'error' })}
            >
              {(['info', 'warn', 'error'] as const).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {(node.type === 'input' || node.type === 'output') && (
        <p className="micro-label pipeline-panel__note">
          passthrough — {node.type === 'input' ? 'emits the run input' : 'emits the final result'}
        </p>
      )}
    </aside>
  );
}
