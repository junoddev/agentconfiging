/**
 * MCP server config models: `.mcp.json` files and embedded `mcpServers`
 * blocks (Claude, Gemini settings, ...). Commands, args, URLs, and env
 * values are surfaced as inert strings; `${VAR}` expansion references are
 * collected so analyzers can reason about them without ever expanding.
 */

import { parseJsonRecord } from './json.js';
import { failed, parsed, problem, type ParseProblem, type ParseResult } from './result.js';
import {
  collectVarRefs,
  isRecord,
  optionalString,
  ownEntries,
  toEnvEntries,
  toStringList,
  type EnvEntry,
} from './values.js';

export interface McpServer {
  name: string;
  /** Declared `type` (http, sse, stdio, local, ...), verbatim if present. */
  type?: string;
  /** Derived transport: declared type, else 'stdio' when command-based, else from url. */
  transport: string;
  command?: string;
  args: string[];
  url?: string;
  env: EnvEntry[];
  headers: EnvEntry[];
  /** `${VAR}` names referenced anywhere in this server's config (never expanded). */
  envVarRefs: string[];
}

export interface McpConfig {
  servers: McpServer[];
}

/** Parse a `.mcp.json` file (root `mcpServers` object). */
export function parseMcpJson(content: string): ParseResult<McpConfig> {
  const root = parseJsonRecord(content);
  if (!root.ok) return failed(root.problems);
  const problems = [...root.problems];
  if (root.model['mcpServers'] === undefined) {
    problems.push(problem('$.mcpServers', 'missing mcpServers object'));
  }
  const servers = mcpServersFromValue(root.model['mcpServers'], '$.mcpServers', problems);
  return parsed({ servers }, problems);
}

/**
 * Extract typed servers from an already-parsed `mcpServers`-shaped value
 * (e.g. the `mcpServers` block inside `.gemini/settings.json` or the `mcp`
 * block in `opencode.json`, where `command` may be an array).
 */
export function mcpServersFromValue(
  value: unknown,
  path: string,
  problems: ParseProblem[],
): McpServer[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) {
    problems.push(problem(path, 'expected an object keyed by server name'));
    return [];
  }
  const servers: McpServer[] = [];
  for (const [name, entry] of ownEntries(value)) {
    const entryPath = `${path}.${name}`;
    if (!isRecord(entry)) {
      problems.push(problem(entryPath, 'expected an object'));
      continue;
    }
    const refs = new Set<string>();
    const server: McpServer = {
      name,
      transport: 'unknown',
      args: [],
      env: toEnvEntries(entry['env'], `${entryPath}.env`, problems),
      headers: toEnvEntries(entry['headers'], `${entryPath}.headers`, problems),
      envVarRefs: [],
    };

    const type = optionalString(entry['type'], `${entryPath}.type`, problems);
    if (type !== undefined) server.type = type;

    const rawCommand = entry['command'];
    if (typeof rawCommand === 'string') {
      server.command = rawCommand;
      server.args = toStringList(entry['args'], `${entryPath}.args`, problems);
    } else if (Array.isArray(rawCommand)) {
      // opencode style: command is ["npx", "-y", "server"].
      const parts = toStringList(rawCommand, `${entryPath}.command`, problems);
      if (parts.length > 0) {
        server.command = parts[0];
        server.args = parts.slice(1);
      }
    } else if (rawCommand !== undefined) {
      problems.push(problem(`${entryPath}.command`, 'expected a string or list of strings'));
    } else if (entry['args'] !== undefined) {
      server.args = toStringList(entry['args'], `${entryPath}.args`, problems);
    }

    const url = optionalString(entry['url'], `${entryPath}.url`, problems);
    if (url !== undefined) server.url = url;

    server.transport =
      type ??
      (server.command !== undefined ? 'stdio' : server.url !== undefined ? 'http' : 'unknown');

    if (server.command !== undefined) collectVarRefs(server.command, refs);
    for (const arg of server.args) collectVarRefs(arg, refs);
    if (server.url !== undefined) collectVarRefs(server.url, refs);
    for (const e of server.env) collectVarRefs(e.value, refs);
    for (const h of server.headers) collectVarRefs(h.value, refs);
    server.envVarRefs = [...refs].sort();

    servers.push(server);
  }
  return servers;
}
