/**
 * ScopePanel — one settings.json scope's visual editor (bead agentconfig-wmc.2,
 * Console E13.4): model, permission mode, allow/ask/deny rule lists, env vars,
 * and statusLine. Hooks are shown read-only (wmc.5 owns their editor). A save
 * serializes the edited model to full-file content and hands it to the
 * parent's shared write flow (dry-run diff → commit).
 *
 * REDACTION-SAVE TRAP: when the served file carries redaction spans, its `env`
 * values arrived as `[REDACTED:*]` placeholders — saving would overwrite the
 * real secrets. Such a file is rendered strictly READ-ONLY (disabled inputs, no
 * save), with a Notice telling the user to edit it directly. See model.ts.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FileContent } from '../../api/index.js';
import {
  Button,
  Field,
  Input,
  Notice,
  Select,
  SourceBadge,
  type SourceScope,
} from '../../components/core/index.js';
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
  /** Provenance badge scope — every configurable surface wears one (§5). */
  scope: SourceScope;
  /** Badge qualifier, e.g. 'git-tracked' / 'gitignored' / 'all projects'. */
  detail?: string;
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
    <div className="field">
      <label>{heading}</label>
      {rules.length === 0 && <div className="meta">none</div>}
      {rules.map((rule, i) => (
        <div key={i} className="settings__rule">
          <Input
            className="mono"
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
              label="Remove"
              variant="ghost"
              onClick={() => onChange(rules.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {!disabled && (
        <div>
          <Button label="Add rule" onClick={() => onChange([...rules, ''])} />
        </div>
      )}
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
    <div className="field">
      <label>Env</label>
      {env.length === 0 && <div className="meta">none</div>}
      {env.map(([k, v], i) => (
        <div key={i} className="settings__env-row">
          <Input
            className="mono settings__input--key"
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
          <Input
            className="mono"
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
              label="Remove"
              variant="ghost"
              onClick={() => onChange(env.filter((_, j) => j !== i))}
            />
          )}
        </div>
      ))}
      {!disabled && (
        <div>
          <Button label="Add variable" onClick={() => onChange([...env, ['', '']])} />
        </div>
      )}
    </div>
  );
}

export function ScopePanel(props: ScopePanelProps) {
  const { title, scope, detail, path, status, file, errMsg, onSave, saving } = props;

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
      <Panel title={title} scope={scope} detail={detail}>
        <p className="meta">loading …</p>
      </Panel>
    );
  }
  if (status === 'unavailable') {
    return (
      <Panel title={title} scope={scope} detail={detail}>
        <p className="meta">{errMsg ?? 'not available for this instance'}</p>
      </Panel>
    );
  }
  if (status === 'error') {
    return (
      <Panel title={title} scope={scope} detail={detail}>
        <Notice>{errMsg ?? 'load failed'}</Notice>
      </Panel>
    );
  }
  if (parsed && !parsed.ok) {
    return (
      <Panel title={title} scope={scope} detail={detail}>
        <Notice>Could not parse as JSON — open it in Artifacts to fix by hand.</Notice>
      </Panel>
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
    <Panel title={title} scope={scope} detail={detail} missing={status === 'missing'}>
      {readOnly && (
        <Notice>
          Read-only — this file contains {file?.spans.length ?? 0} redacted secret
          {(file?.spans.length ?? 0) === 1 ? '' : 's'}; saving here would overwrite them. Edit the
          file directly.
        </Notice>
      )}

      <Field label="Model" htmlFor={`${title}-model`}>
        <Input
          id={`${title}-model`}
          className="mono"
          value={draft.model}
          disabled={readOnly}
          placeholder="(inherit) e.g. claude-opus-4-5"
          onChange={(e) => update('model', e.target.value)}
        />
      </Field>

      <Field label="Permission mode" htmlFor={`${title}-mode`}>
        <Select
          id={`${title}-mode`}
          className="mono"
          value={draft.defaultMode}
          disabled={readOnly}
          onChange={(e) => update('defaultMode', e.target.value)}
        >
          {PERMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {m === '' ? '(unset)' : m}
            </option>
          ))}
        </Select>
      </Field>

      <RuleList
        heading="Allow"
        rules={draft.allow}
        disabled={readOnly}
        onChange={(next) => update('allow', next)}
      />
      <RuleList
        heading="Ask"
        rules={draft.ask}
        disabled={readOnly}
        onChange={(next) => update('ask', next)}
      />
      <RuleList
        heading="Deny"
        rules={draft.deny}
        disabled={readOnly}
        onChange={(next) => update('deny', next)}
      />

      <EnvRows env={draft.env} disabled={readOnly} onChange={(next) => update('env', next)} />

      <div className="field">
        <label>Status line</label>
        <div className="settings__env-row">
          <Input
            className="mono settings__input--key"
            value={draft.statusLineType}
            disabled={readOnly}
            aria-label="status line type"
            placeholder="command"
            onChange={(e) => update('statusLineType', e.target.value)}
          />
          <Input
            className="mono"
            value={draft.statusLineCommand}
            disabled={readOnly}
            aria-label="status line command"
            placeholder=".claude/statusline.sh"
            onChange={(e) => update('statusLineCommand', e.target.value)}
          />
        </div>
      </div>

      {meta?.hasHooks && (
        <p className="meta">
          {meta.hookEventCount} hook event{meta.hookEventCount === 1 ? '' : 's'} defined · edited in
          Hooks (preserved on save)
        </p>
      )}

      {!readOnly && path !== undefined && (
        <div className="settings__actions">
          <Button
            label={status === 'missing' ? 'Create' : 'Save'}
            variant="primary"
            disabled={!dirty || saving}
            onClick={() =>
              onSave(path, nextContent, `${title} · ${status === 'missing' ? 'create' : 'save'}`)
            }
          />
        </div>
      )}
    </Panel>
  );
}

/** Card chassis: mono title + provenance badge head over the editor body. */
function Panel({
  title,
  scope,
  detail,
  missing,
  children,
}: {
  title: string;
  scope: SourceScope;
  detail?: string;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="settings__panel-head">
        <span className="mono-data settings__panel-title">{title}</span>
        <SourceBadge scope={scope} detail={detail} />
        {missing === true && <span className="meta">not created</span>}
      </div>
      {children}
    </section>
  );
}
