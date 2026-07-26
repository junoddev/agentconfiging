/**
 * ScopePanel — one settings.json scope's visual editor (bead agentconfig-wmc.2):
 * model, permission mode, allow/ask/deny rule lists, env vars, and statusLine.
 * Hooks are shown read-only (wmc.5 owns their editor). A save serializes the
 * edited model to full-file content and hands it to the parent's shared write
 * flow (dry-run diff → commit).
 *
 * REDACTION-SAVE TRAP: when the served file carries redaction spans, its `env`
 * values arrived as `[REDACTED:*]` placeholders — saving would overwrite the
 * real secrets. Such a file is rendered strictly READ-ONLY (disabled inputs, no
 * save), with a banner telling the user to edit it directly. See model.ts.
 */

import { useEffect, useMemo, useState } from 'react';
import type { FileContent } from '../../api/index.js';
import { Button } from '../../components/core/index.js';
import {
  emptyModel,
  hasRedactions,
  parseSettings,
  serializeSettings,
  type SettingsModel,
  PERMISSION_MODES,
} from './model.js';

export type LoadStatus = 'loading' | 'ok' | 'missing' | 'error' | 'unavailable';

export interface ScopePanelProps {
  title: string;
  /** Provenance tag, e.g. "SHARED · git-tracked" / "LOCAL · gitignored". */
  tag: string;
  /** The write path (relative or absolute); undefined when the scope is absent. */
  path?: string;
  status: LoadStatus;
  file?: FileContent;
  errMsg?: string;
  /** Hand full-file content to the parent's shared write flow. */
  onSave: (path: string, content: string, label: string) => void;
  /** A save flow is currently in progress for THIS panel's path. */
  saving?: boolean;
}

function RuleList({
  heading,
  rules,
  disabled,
  onChange,
}: {
  heading: string;
  rules: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="settings__field">
      <div className="micro-label">{heading}</div>
      {rules.length === 0 && <div className="settings__none micro-label">none</div>}
      {rules.map((rule, i) => (
        <div key={i} className="settings__rule">
          <input
            className="settings__input mono-data"
            value={rule}
            disabled={disabled}
            aria-label={`${heading} rule ${String(i + 1)}`}
            onChange={(e) => {
              const next = rules.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          {!disabled && (
            <Button
              label="remove"
              variant="destructive"
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {!disabled && <Button label="add rule" onClick={() => onChange([...rules, ''])} />}
    </div>
  );
}

function EnvRows({
  env,
  disabled,
  onChange,
}: {
  env: Array<[string, string]>;
  disabled: boolean;
  onChange: (next: Array<[string, string]>) => void;
}) {
  return (
    <div className="settings__field">
      <div className="micro-label">ENV</div>
      {env.length === 0 && <div className="settings__none micro-label">none</div>}
      {env.map(([k, v], i) => (
        <div key={i} className="settings__env-row">
          <input
            className="settings__input settings__input--key mono-data"
            value={k}
            disabled={disabled}
            aria-label={`env key ${String(i + 1)}`}
            placeholder="KEY"
            onChange={(e) => {
              const next = env.slice();
              next[i] = [e.target.value, v];
              onChange(next);
            }}
          />
          <input
            className="settings__input mono-data"
            value={v}
            disabled={disabled}
            aria-label={`env value ${String(i + 1)}`}
            placeholder="value"
            onChange={(e) => {
              const next = env.slice();
              next[i] = [k, e.target.value];
              onChange(next);
            }}
          />
          {!disabled && (
            <Button
              label="remove"
              variant="destructive"
              onClick={() => onChange(env.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {!disabled && <Button label="add var" onClick={() => onChange([...env, ['', '']])} />}
    </div>
  );
}

export function ScopePanel(props: ScopePanelProps) {
  const { title, tag, path, status, file, errMsg, onSave, saving } = props;

  // Parse the served (redacted) content once per file. `missing` seeds an empty
  // baseline so the panel can CREATE the file.
  const parsed = useMemo(() => {
    if (status === 'missing') return { ok: true as const, raw: {}, model: emptyModel() };
    if (status === 'ok' && file) {
      const p = parseSettings(file.content);
      if (p.ok) return { ok: true as const, raw: p.raw, model: p.model, meta: p };
      return { ok: false as const };
    }
    return undefined;
  }, [status, file]);

  const redacted = status === 'ok' && file ? hasRedactions(file.spans) : false;
  const readOnly = redacted; // secrets present → never save over them.

  const [draft, setDraft] = useState<SettingsModel>(emptyModel);
  useEffect(() => {
    if (parsed?.ok) setDraft(parsed.model);
  }, [parsed]);

  if (status === 'loading') {
    return (
      <section className="settings__panel surface">
        <PanelHead title={title} tag={tag} />
        <p className="micro-label">loading…</p>
      </section>
    );
  }
  if (status === 'unavailable') {
    return (
      <section className="settings__panel surface">
        <PanelHead title={title} tag={tag} />
        <p className="settings__note micro-label">{errMsg ?? 'not available for this instance'}</p>
      </section>
    );
  }
  if (status === 'error') {
    return (
      <section className="settings__panel surface">
        <PanelHead title={title} tag={tag} />
        <p className="settings__note settings__note--warn micro-label">{errMsg ?? 'load failed'}</p>
      </section>
    );
  }
  if (parsed && !parsed.ok) {
    return (
      <section className="settings__panel surface">
        <PanelHead title={title} tag={tag} />
        <p className="settings__note settings__note--warn micro-label">
          could not parse as JSON — open it in ARTIFACTS to fix by hand
        </p>
      </section>
    );
  }
  if (!parsed?.ok) return null;

  const raw = parsed.raw;
  const meta = 'meta' in parsed ? parsed.meta : undefined;
  const original = file?.content ?? '';
  const nextContent = serializeSettings(raw, draft);
  const dirty = status === 'missing' ? true : nextContent !== original;

  const update = <K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <section className="settings__panel surface">
      <PanelHead title={title} tag={tag} status={status} />

      {readOnly && (
        <p className="settings__note settings__note--warn micro-label">
          read-only · this file contains {file?.spans.length ?? 0} redacted secret
          {(file?.spans.length ?? 0) === 1 ? '' : 's'} — editing here would overwrite them. Edit the
          file directly.
        </p>
      )}

      <div className="settings__field">
        <label className="micro-label" htmlFor={`${title}-model`}>
          MODEL
        </label>
        <input
          id={`${title}-model`}
          className="settings__input mono-data"
          value={draft.model}
          disabled={readOnly}
          placeholder="(inherit) e.g. claude-opus-4-5"
          onChange={(e) => update('model', e.target.value)}
        />
      </div>

      <div className="settings__field">
        <label className="micro-label" htmlFor={`${title}-mode`}>
          PERMISSION MODE
        </label>
        <select
          id={`${title}-mode`}
          className="settings__input mono-data"
          value={draft.defaultMode}
          disabled={readOnly}
          onChange={(e) => update('defaultMode', e.target.value)}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m === '' ? '(unset)' : m}
            </option>
          ))}
        </select>
      </div>

      <RuleList
        heading="ALLOW"
        rules={draft.allow}
        disabled={readOnly}
        onChange={(next) => update('allow', next)}
      />
      <RuleList
        heading="ASK"
        rules={draft.ask}
        disabled={readOnly}
        onChange={(next) => update('ask', next)}
      />
      <RuleList
        heading="DENY"
        rules={draft.deny}
        disabled={readOnly}
        onChange={(next) => update('deny', next)}
      />

      <EnvRows env={draft.env} disabled={readOnly} onChange={(next) => update('env', next)} />

      <div className="settings__field">
        <div className="micro-label">STATUS LINE</div>
        <div className="settings__env-row">
          <input
            className="settings__input settings__input--key mono-data"
            value={draft.statusLineType}
            disabled={readOnly}
            aria-label="status line type"
            placeholder="command"
            onChange={(e) => update('statusLineType', e.target.value)}
          />
          <input
            className="settings__input mono-data"
            value={draft.statusLineCommand}
            disabled={readOnly}
            aria-label="status line command"
            placeholder=".claude/statusline.sh"
            onChange={(e) => update('statusLineCommand', e.target.value)}
          />
        </div>
      </div>

      {meta?.hasHooks && (
        <p className="settings__note micro-label">
          {meta.hookEventCount} hook event{meta.hookEventCount === 1 ? '' : 's'} defined · edited in
          HOOKS (preserved on save)
        </p>
      )}

      {!readOnly && path !== undefined && (
        <div className="settings__actions">
          <Button
            label={status === 'missing' ? 'create' : 'save'}
            variant="primary"
            disabled={!dirty || saving}
            onClick={() =>
              onSave(path, nextContent, `${title} · ${status === 'missing' ? 'create' : 'save'}`)
            }
          />
        </div>
      )}
    </section>
  );
}

function PanelHead({ title, tag, status }: { title: string; tag: string; status?: LoadStatus }) {
  return (
    <div className="settings__panel-head">
      <span className="mono-data settings__panel-title">{title}</span>
      <span className="micro-label settings__panel-tag">{tag}</span>
      {status === 'missing' && <span className="micro-label settings__panel-tag">not created</span>}
    </div>
  );
}
