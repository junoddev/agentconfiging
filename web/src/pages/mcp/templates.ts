/**
 * MCP server starter templates (bead agentconfig-wmc.8) — inert data only.
 * Picking one prefills the add form; nothing here runs or resolves. The github
 * template intentionally uses a `${GITHUB_TOKEN}` env REFERENCE, never a literal
 * secret — the reference is carried through verbatim (see logic.isEnvRef).
 *
 * These mirror the canonical `@modelcontextprotocol/server-*` stdio servers.
 * Placeholder paths/URLs (`/path/...`, `postgresql://localhost/...`) are meant
 * to be edited before saving.
 */

import type { McpServer } from './logic.js';

export interface McpTemplate {
  id: string;
  label: string;
  /** Short one-line hint shown under the picker. */
  hint: string;
  /** Prefill for the add form (a fresh object per pick — clone before mutating). */
  server: McpServer;
}

export const MCP_TEMPLATES: readonly McpTemplate[] = [
  {
    id: 'filesystem',
    label: 'filesystem',
    hint: 'read/write files under an allowed directory',
    server: {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
      extra: {},
    },
  },
  {
    id: 'github',
    label: 'github',
    hint: 'GitHub API access via a token reference',
    server: {
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}' },
      extra: {},
    },
  },
  {
    id: 'postgres',
    label: 'postgres',
    hint: 'read-only Postgres schema + queries',
    server: {
      name: 'postgres',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost:5432/db'],
      extra: {},
    },
  },
  {
    id: 'memory',
    label: 'memory',
    hint: 'in-process knowledge-graph memory',
    server: {
      name: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      extra: {},
    },
  },
];

/** Deep-ish clone of a template's server so the form can mutate freely. */
export function cloneTemplate(template: McpTemplate): McpServer {
  const s = template.server;
  return {
    name: s.name,
    transport: s.transport,
    command: s.command,
    args: s.args ? [...s.args] : undefined,
    url: s.url,
    type: s.type,
    env: s.env ? { ...s.env } : undefined,
    headers: s.headers ? { ...s.headers } : undefined,
    extra: { ...s.extra },
  };
}
