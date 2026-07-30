/**
 * ServerForm — the add/edit form for one MCP server (bead wmc.8, Console
 * conversion 4u1.4). Rendered inside the shared Dialog; builds an
 * {@link McpServer} from `.field`/`.input` controls and hands it to
 * `onPreview`, which drives the dry-run diff through useWriteFlow. It performs
 * NO write itself. `${VAR}` env/header values are typed and stored literally —
 * nothing here expands them. In add mode a template picker prefills the fields.
 *
 * Extra (unmodeled) keys from an edited server are preserved: the form keeps the
 * original server's `extra`/`type` and re-attaches them to the built value.
 */

import { useMemo, useState } from 'react';
import { Button, Field, Input, Notice, SegmentedControl } from '../../components/core/index.js';
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

const TRANSPORTS = ['stdio', 'http'] as const;

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
    <div>
      {mode === 'add' && (
        <div className="mcp-form-templates">
          <span className="meta">Start from template</span>
          {MCP_TEMPLATES.map((t) => (
            <Button key={t.id} label={t.label} onClick={() => applyTemplate(t.id)} />
          ))}
        </div>
      )}

      <Field label="Name" htmlFor="mcp-name">
        <Input
          id="mcp-name"
          className="mono"
          value={state.name}
          onChange={(e) => set('name', e.target.value)}
          spellCheck={false}
        />
      </Field>

      <Field label="Transport" htmlFor="mcp-transport">
        <SegmentedControl
          options={TRANSPORTS}
          value={state.transport}
          onChange={(v) => set('transport', v as Transport)}
          label="Transport"
        />
      </Field>

      {state.transport === 'stdio' ? (
        <>
          <Field label="Command" htmlFor="mcp-command">
            <Input
              id="mcp-command"
              className="mono"
              value={state.command}
              onChange={(e) => set('command', e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field label="Args · one per line" htmlFor="mcp-args">
            <textarea
              id="mcp-args"
              className="input mono"
              value={state.args}
              onChange={(e) => set('args', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </Field>
          <Field label={'Env · KEY=VALUE per line · ${VAR} refs kept literal'} htmlFor="mcp-env">
            <textarea
              id="mcp-env"
              className="input mono"
              value={state.env}
              onChange={(e) => set('env', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="URL" htmlFor="mcp-url">
            <Input
              id="mcp-url"
              className="mono"
              value={state.url}
              onChange={(e) => set('url', e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field
            label={'Headers · KEY=VALUE per line · ${VAR} refs kept literal'}
            htmlFor="mcp-headers"
          >
            <textarea
              id="mcp-headers"
              className="input mono"
              value={state.headers}
              onChange={(e) => set('headers', e.target.value)}
              spellCheck={false}
              rows={3}
            />
          </Field>
        </>
      )}

      {invalid !== undefined && (
        <Notice tone="info">
          <strong>Not previewable yet.</strong> {invalid}
        </Notice>
      )}

      <div className="mcp-form-actions">
        <Button label="Cancel" onClick={onCancel} />
        <Button
          label="Preview change"
          variant="primary"
          disabled={invalid !== undefined}
          onClick={() => onPreview(build(state))}
        />
      </div>
    </div>
  );
}
