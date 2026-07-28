/**
 * MCP manager — pure, DOM-free logic (bead agentconfig-wmc.8). Kept out of the
 * component so parsing `mcpServers` blocks, serializing edits back to file
 * content, detecting `${VAR}` env refs, and spotting redaction marks are all
 * unit-testable over plain values. The React page is a thin shell over these.
 *
 * DATA SAFETY (two invariants enforced here):
 *  1. `${VAR}` env/header references are NEVER expanded — they round-trip as the
 *     literal string. {@link isEnvRef} only *labels* them; nothing resolves them.
 *  2. A file whose served content carries any `[REDACTED:*]` mark
 *     ({@link hasRedactionMarks}) must be treated READ-ONLY by callers: writing
 *     the redacted placeholder back would clobber the real secret on disk. This
 *     module never resolves or invents secret values — it only reserializes the
 *     doc it was given, so the page must refuse edits on redacted files.
 *
 * All parsing is JSON only (JSON.parse) — no YAML/TOML. `.mcp.json` carries the
 * block at the document root; settings files (`settings.json`,
 * `settings.local.json`, `.gemini/settings.json`, …) carry it under the same
 * `mcpServers` key, so one parser serves both.
 */

import type { DetectedAgent, GlobalEntry } from '../../api/types.js';

/** Transport bucket. `http` covers any URL-addressed remote (incl. `sse`). */
export type Transport = 'stdio' | 'http';

/**
 * One MCP server, normalized from a `mcpServers` entry. Optional fields are only
 * present when the source carried them, so {@link serverToConfig} round-trips
 * without inventing keys. `extra` preserves any keys this model does not
 * understand (e.g. `timeout`) verbatim.
 */
export interface McpServer {
  name: string;
  transport: Transport;
  /** stdio: the executable to spawn. */
  command?: string;
  /** stdio: argv after the command. */
  args?: string[];
  /** http: the endpoint URL (rendered as text; never fetched). */
  url?: string;
  /** Original `type` string (e.g. 'http', 'sse'), preserved for round-trip. */
  type?: string;
  /** stdio: environment map. Values may be `${VAR}` refs — kept literal. */
  env?: Record<string, string>;
  /** http: request headers. Values may be `${VAR}` refs — kept literal. */
  headers?: Record<string, string>;
  /** Unmodeled keys, preserved verbatim so a round-trip loses nothing. */
  extra: Record<string, unknown>;
}

/** Result of parsing one candidate MCP file's (already redacted) JSON content. */
export interface ParsedMcpFile {
  /** Servers found under `mcpServers` (malformed entries skipped). */
  servers: McpServer[];
  /** The full parsed document, for reserialization; null when parse failed. */
  doc: Record<string, unknown> | null;
  /** True when `JSON.parse` threw — the file is unusable. */
  parseError: boolean;
  /** True when a well-formed `mcpServers` object was present. */
  hasBlock: boolean;
}

const REDACT_RE = /\[REDACTED:[^\]]*\]/;
const ENV_REF_RE = /\$\{[^}]+\}/;

/** Whether served content carries any `[REDACTED:*]` mark → editing is unsafe. */
export function hasRedactionMarks(content: string): boolean {
  return REDACT_RE.test(content);
}

/** Whether a value contains a `${VAR}` reference. Purely a label — the value is
 *  always rendered/serialized literally, never expanded. */
export function isEnvRef(value: string): boolean {
  return ENV_REF_RE.test(value);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collect only string→string pairs from an unknown object (env/headers). */
function stringMap(v: unknown): Record<string, string> | undefined {
  if (!isPlainObject(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return Object.keys(out).length > 0 ? out : {};
}

function detectTransport(raw: Record<string, unknown>): Transport {
  const type = typeof raw.type === 'string' ? raw.type : undefined;
  if (type === 'http' || type === 'sse' || type === 'http-stream') return 'http';
  if (typeof raw.url === 'string' && typeof raw.command !== 'string') return 'http';
  return 'stdio';
}

const KNOWN_KEYS = new Set(['command', 'args', 'url', 'type', 'env', 'headers']);

/** Normalize one `mcpServers` entry to an {@link McpServer}, or null if the raw
 *  value is not a JSON object (a malformed entry the caller should skip). */
export function parseServer(name: string, raw: unknown): McpServer | null {
  if (!isPlainObject(raw)) return null;
  const transport = detectTransport(raw);
  const server: McpServer = { name, transport, extra: {} };

  if (typeof raw.type === 'string') server.type = raw.type;
  if (typeof raw.command === 'string') server.command = raw.command;
  if (Array.isArray(raw.args)) {
    server.args = raw.args.filter((a): a is string => typeof a === 'string');
  }
  if (typeof raw.url === 'string') server.url = raw.url;

  const env = stringMap(raw.env);
  if (env && isPlainObject(raw.env)) server.env = env;
  const headers = stringMap(raw.headers);
  if (headers && isPlainObject(raw.headers)) server.headers = headers;

  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(k)) server.extra[k] = v;
  }
  return server;
}

/** Inverse of {@link parseServer}: the JSON value for one server entry. Emits
 *  only the fields the model holds, then merges `extra`, so a parse→serialize
 *  round-trip of an untouched server is value-equal to the original. */
export function serverToConfig(server: McpServer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (server.transport === 'http') {
    out.type = server.type ?? 'http';
    if (server.url !== undefined) out.url = server.url;
    if (server.headers !== undefined) out.headers = server.headers;
  } else {
    if (server.command !== undefined) out.command = server.command;
    if (server.args !== undefined) out.args = server.args;
    if (server.env !== undefined) out.env = server.env;
  }
  for (const [k, v] of Object.entries(server.extra)) out[k] = v;
  return out;
}

/** Parse one candidate file's content. Tolerant: bad JSON → `parseError`; a
 *  non-object document or missing block → no servers, `hasBlock:false`. */
export function parseMcpFile(content: string): ParsedMcpFile {
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    return { servers: [], doc: null, parseError: true, hasBlock: false };
  }
  if (!isPlainObject(doc)) {
    return { servers: [], doc: null, parseError: false, hasBlock: false };
  }
  const block = doc.mcpServers;
  const hasBlock = isPlainObject(block);
  const servers: McpServer[] = [];
  if (hasBlock) {
    for (const [name, raw] of Object.entries(block)) {
      const parsed = parseServer(name, raw);
      if (parsed) servers.push(parsed);
    }
  }
  return { servers, doc, parseError: false, hasBlock };
}

/** Rebuild file content from a document and a new server list. The `mcpServers`
 *  block is replaced; every other key in `doc` is preserved untouched. Pass an
 *  empty `doc` ({}) to author a fresh `.mcp.json`. Output is 2-space JSON with a
 *  trailing newline (the repo's file convention). */
export function serializeMcpDoc(
  doc: Record<string, unknown>,
  servers: readonly McpServer[],
): string {
  const block: Record<string, unknown> = {};
  for (const s of servers) block[s.name] = serverToConfig(s);
  const next = { ...doc, mcpServers: block };
  return JSON.stringify(next, null, 2) + '\n';
}

/** Replace-or-append `updated` by name; `replaceName` (an edit's original name)
 *  is also dropped so a rename does not leave the old entry behind. */
export function upsertServer(
  servers: readonly McpServer[],
  updated: McpServer,
  replaceName?: string,
): McpServer[] {
  const kept = servers.filter((s) => s.name !== updated.name && s.name !== replaceName);
  return [...kept, updated];
}

/** Drop the server with `name`. */
export function removeServer(servers: readonly McpServer[], name: string): McpServer[] {
  return servers.filter((s) => s.name !== name);
}

/** Basename test: is this a file that can carry an `mcpServers` block? */
export function isMcpCandidate(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return base === '.mcp.json' || base === 'settings.json' || base === 'settings.local.json';
}

/** De-duplicated, sorted list of candidate MCP files referenced by any agent. */
export function collectMcpCandidates(agents: readonly Pick<DetectedAgent, 'files'>[]): string[] {
  const set = new Set<string>();
  for (const agent of agents) {
    for (const file of agent.files) if (isMcpCandidate(file)) set.add(file);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** One machine-global candidate MCP file (bead 71h.4): its home config dir's
 *  absolute `root` plus the file's ABSOLUTE `path` (getFile takes it as-is). */
export interface GlobalMcpCandidate {
  root: string;
  path: string;
}

/**
 * Candidate MCP files across the machine-global report's entries (~/.claude,
 * ~/.gemini, …). Entry agent `files` are RELATIVE to each entry's `root`, so
 * candidates are joined to absolute paths. Same basename recognition as
 * {@link collectMcpCandidates}; de-duplicated and path-sorted. Callers must
 * treat every result READ-ONLY — a global file is never a write target.
 */
export function collectGlobalMcpCandidates(
  entries: readonly (Pick<GlobalEntry, 'root'> & {
    agents: readonly Pick<DetectedAgent, 'files'>[];
  })[],
): GlobalMcpCandidate[] {
  const byPath = new Map<string, GlobalMcpCandidate>();
  for (const entry of entries) {
    for (const agent of entry.agents) {
      for (const file of agent.files) {
        if (!isMcpCandidate(file)) continue;
        const path = `${entry.root}/${file}`;
        if (!byPath.has(path)) byPath.set(path, { root: entry.root, path });
      }
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Cloud-configured MCP servers surfaced through agent `extras`, shown READ-ONLY.
 * These are not in any local file the manager can edit — a runtime that knows
 * about cloud/console-managed servers can expose them under
 * `extras.cloudMcpServers` (a name→config map) and they render as read-only
 * cards. v1 fixture data carries none, so this returns [] and the section is
 * omitted — deliberately not faked.
 */
export function collectCloudServers(agents: readonly Pick<DetectedAgent, 'extras'>[]): McpServer[] {
  const out: McpServer[] = [];
  for (const agent of agents) {
    const cloud = agent.extras?.cloudMcpServers;
    if (isPlainObject(cloud)) {
      for (const [name, raw] of Object.entries(cloud)) {
        const parsed = parseServer(name, raw);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

// ── Form <-> model text helpers (multiline textarea encodings) ──────────────

/** One arg per non-blank line. */
export function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Inverse of {@link parseArgsText}. */
export function formatArgsText(args: readonly string[] | undefined): string {
  return (args ?? []).join('\n');
}

/** `KEY=VALUE` per non-blank line. The value keeps `${VAR}` refs verbatim. */
export function parseKeyVals(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Inverse of {@link parseKeyVals}. */
export function formatKeyVals(rec: Record<string, string> | undefined): string {
  return Object.entries(rec ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}
