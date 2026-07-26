/**
 * ServerForm — the visual add/edit form for one MCP server (bead wmc.8). It
 * builds an {@link McpServer} from plain inputs and hands it to `onPreview`,
 * which drives the dry-run diff through useWriteFlow. It performs NO write
 * itself. `${VAR}` env/header values are typed and stored literally — nothing
 * here expands them. In add mode a template picker prefills the fields.
 *
 * Extra (unmodeled) keys from an edited server are preserved: the form keeps the
 * original server's `extra`/`type` and re-attaches them to the built value.
 */

import { useMemo, useState } from 'react';
import { Button } from '../../components/core/index.js';
import {
  formatArgsText,
  formatKeyVals,
  parseArgsText,
  parseKeyVals,
  type McpServer,
  type Transport,
} from './logic.js';
import { MCP_TEMPLATES, cloneTemplate } from './templates.js';

export interface ServerFormProps {
  mode: 'add' | 'edit';
  /** The server being edited (edit mode) — seeds the fields. */
  initial?: McpServer;
  /** Names already present in the target file (edit's own name excluded). */
  existingNames: readonly string[];
  onPreview: (server: McpServer) => void;
  onCancel: () => void;
}

interface FormState {
  name: string;
  transport: Transport;
  command: string;
  args: string;
  url: string;
  env: string;
  headers: string;
  /** Carried through untouched from the seed server. */
  type?: string;
  extra: Record<string, unknown>;
}

function seed(initial: McpServer | undefined): FormState {
  if (!initial) {
    return {
      name: '',
      transport: 'stdio',
      command: '',
      args: '',
      url: '',
      env: '',
      headers: '',
      extra: {},
    };
  }
  return {
    name: initial.name,
    transport: initial.transport,
    command: initial.command ?? '',
    args: formatArgsText(initial.args),
    url: initial.url ?? '',
    env: formatKeyVals(initial.env),
    headers: formatKeyVals(initial.headers),
    type: initial.type,
    extra: { ...initial.extra },
  };
}

function build(state: FormState): McpServer {
  const server: McpServer = {
    name: state.name.trim(),
    transport: state.transport,
    extra: state.extra,
  };
  if (state.type !== undefined) server.type = state.type;
  if (state.transport === 'stdio') {
    server.command = state.command.trim();
    const args = parseArgsText(state.args);
    if (args.length > 0) server.args = args;
    const env = parseKeyVals(state.env);
    if (Object.keys(env).length > 0) server.env = env;
  } else {
    server.url = state.url.trim();
    const headers = parseKeyVals(state.headers);
    if (Object.keys(headers).length > 0) server.headers = headers;
  }
  return server;
}

/** Non-empty reason the form is not previewable yet, or undefined when valid. */
function invalidReason(state: FormState, existingNames: readonly string[]): string | undefined {
  const name = state.name.trim();
  if (!name) return 'name is required';
  if (existingNames.includes(name)) return 'a server with this name already exists';
  if (state.transport === 'stdio') {
    if (!state.command.trim()) return 'command is required for a stdio server';
  } else if (!state.url.trim()) {
    return 'url is required for an http server';
  }
  return undefined;
}

export function ServerForm({ mode, initial, existingNames, onPreview, onCancel }: ServerFormProps) {
  const [state, setState] = useState<FormState>(() => seed(initial));

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const invalid = useMemo(() => invalidReason(state, existingNames), [state, existingNames]);

  function applyTemplate(id: string) {
    const template = MCP_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    setState(seed(cloneTemplate(template)));
  }

  return (
    <div className="mcp-form surface">
      <div className="mcp-form__title micro-label">
        {mode === 'add' ? 'add server' : `edit · ${initial?.name ?? ''}`}
      </div>

      {mode === 'add' && (
        <div className="mcp-form__templates">
          <span className="micro-label">start from template</span>
          <div className="mcp-form__template-row">
            {MCP_TEMPLATES.map((t) => (
              <Button key={t.id} label={t.label} onClick={() => applyTemplate(t.id)} />
            ))}
          </div>
        </div>
      )}

      <label className="mcp-form__field">
        <span className="micro-label">name</span>
        <input
          className="mcp-form__input mono-data"
          value={state.name}
          onChange={(e) => set('name', e.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="mcp-form__field">
        <span className="micro-label">transport</span>
        <div className="mcp-form__transport">
          <Button
            label="stdio"
            variant={state.transport === 'stdio' ? 'primary' : 'default'}
            onClick={() => set('transport', 'stdio')}
          />
          <Button
            label="http"
            variant={state.transport === 'http' ? 'primary' : 'default'}
            onClick={() => set('transport', 'http')}
          />
        </div>
      </div>

      {state.transport === 'stdio' ? (
        <>
          <label className="mcp-form__field">
            <span className="micro-label">command</span>
            <input
              className="mcp-form__input mono-data"
              value={state.command}
              onChange={(e) => set('command', e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="mcp-form__field">
            <span className="micro-label">args · one per line</span>
            <textarea
              className="mcp-form__input mcp-form__area mono-data"
              value={state.args}
              onChange={(e) => set('args', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </label>
          <label className="mcp-form__field">
            <span className="micro-label">
              env · KEY=VALUE per line · ${'{VAR}'} refs kept literal
            </span>
            <textarea
              className="mcp-form__input mcp-form__area mono-data"
              value={state.env}
              onChange={(e) => set('env', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </label>
        </>
      ) : (
        <>
          <label className="mcp-form__field">
            <span className="micro-label">url</span>
            <input
              className="mcp-form__input mono-data"
              value={state.url}
              onChange={(e) => set('url', e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="mcp-form__field">
            <span className="micro-label">
              headers · KEY=VALUE per line · ${'{VAR}'} refs kept literal
            </span>
            <textarea
              className="mcp-form__input mcp-form__area mono-data"
              value={state.headers}
              onChange={(e) => set('headers', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </label>
        </>
      )}

      {invalid !== undefined && <p className="mcp-form__hint micro-label">{invalid}</p>}

      <div className="mcp-form__actions">
        <Button
          label="preview change"
          variant="primary"
          disabled={invalid !== undefined}
          onClick={() => onPreview(build(state))}
        />
        <Button label="cancel" onClick={onCancel} />
      </div>
    </div>
  );
}
