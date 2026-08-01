/**
 * marketplace — the Claude Code PLUGIN MARKETPLACE surface (SPEC §4.5, §5 row 9,
 * bead agentconfig-0zm.5). Registered under `/api`, so every route INHERITS the
 * hardened app's gates (Host allowlist, bearer token, same-origin/CSRF). This
 * module adds no gate of its own; it adds a SUBPROCESS trust boundary.
 *
 * WHY A SUBPROCESS (and not direct file writes) — the DECISION:
 * The Claude Code plugin system — marketplaces, `plugin.json`, git-subdir/ref/sha
 * source resolution, enable/disable state, dependency pruning, and the registry
 * under `~/.claude/plugins` — is owned entirely by the `claude` CLI. Our OWN
 * registry (bead 0zm.4, src/server/catalog.ts) installs via the guarded direct-
 * write path because we own that content and its on-disk format. The Claude
 * marketplace is the CLI's domain: reimplementing its install (clone the source,
 * check out ref/sha, validate config, mutate the CLI's own registry state) via
 * direct file writes would be a fragile, incomplete clone that could CORRUPT the
 * CLI's state. So we DELEGATE to `claude` and make the subprocess itself safe.
 *
 * THE SUBPROCESS SECURITY MODEL — every call obeys all of:
 *  1. execFile, NEVER a shell. The command is the FIXED literal `claude`; there
 *     is no `shell:true`, so there is no shell to interpret metacharacters. Args
 *     are passed as an ARGUMENT ARRAY — a value can only ever be one argv slot,
 *     never a second command.
 *  2. NO user/registry input is string-interpolated into a command. The only
 *     dynamic value is a plugin name on install; it is passed as a POSITIONAL
 *     arg to execFile after validation.
 *  3. VALIDATION of that name is layered: (a) a strict charset
 *     `^[a-zA-Z0-9._@/-]+$` + length cap rejects anything shell-ish BEFORE any
 *     process is spawned, then (b) an ALLOWLIST check — the name must be one the
 *     live marketplace listing returned (pluginId or name). Neither passes → the
 *     install is refused and `claude plugin install` is never spawned.
 *  4. TIMEOUT on every spawn — a hung CLI is killed, surfaced as a graceful
 *     unavailable state, never left hanging.
 *  5. CLI-ABSENT is graceful — an ENOENT (or any spawn failure) degrades to a
 *     typed `{ available: false, reason }`, never a 500 and never a crash.
 *  6. The CLI's stdout is UNTRUSTED — it is marketplace data written by other
 *     people. It is parsed DEFENSIVELY (JSON.parse guarded, shapes checked,
 *     fresh output objects, never spread) and is NEVER evaluated. Callers render
 *     every field as a text node.
 */

import { execFile } from 'node:child_process';
import type { Hono } from 'hono';
import { asObject } from './http.js';

/** How the routes reach the `claude` CLI. Injectable so tests fire a FAKE exec
 *  (a valid listing, a hostile payload, an ENOENT, a timeout) at the real parse
 *  + validation path with no real CLI present. */
export type ClaudeExec = (args: string[], opts: { timeoutMs: number }) => Promise<ExecResult>;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/** Default exec: FIXED command `claude`, ARG ARRAY, no shell, hard timeout +
 *  bounded buffer. A spawn failure (CLI absent) rejects with `code:'ENOENT'`;
 *  a timeout kills the child and rejects with `killed:true`. */
const defaultClaudeExec: ClaudeExec = (args, { timeoutMs }) =>
  new Promise<ExecResult>((resolve, reject) => {
    execFile(
      'claude',
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      },
    );
  });

const DEFAULT_TIMEOUT_MS = 20_000;

/** Strict install-name charset: alphanumerics + the pluginId punctuation
 *  (`name@marketplace`, scoped paths). Deliberately excludes every shell
 *  metacharacter (`; | & $ ( ) \` < > space …`). A leading `-` is forbidden so
 *  an attacker-controlled marketplace id like `--force`/`-x` can never reach
 *  `claude plugin install` as a FLAG (flag injection) — belt to the `--`
 *  end-of-options separator the install spawn also uses. */
const NAME_CHARSET = /^[a-zA-Z0-9._@/][a-zA-Z0-9._@/-]*$/;
const MAX_NAME_LEN = 200;

export interface MarketplaceRoutesConfig {
  /** Injectable `claude` exec; defaults to the real subprocess. */
  exec?: ClaudeExec;
  /** Per-call timeout; defaults to 20s. */
  timeoutMs?: number;
}

// ── Wire types (mirrored in web/src/api/types.ts) ─────────────────────────────

export interface MarketplacePlugin {
  /** `pluginId`, e.g. `foo@claude-plugins-official` — the install allowlist key. */
  id: string;
  name: string;
  description: string;
  /** Best-effort version label (from `source.ref` when present), else ''. */
  version: string;
  /** Install count when the CLI reports one; omitted otherwise. */
  installCount?: number;
  /** Human source label (url / path / kind); never an object. Text only. */
  source: string;
  marketplace: string;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  scope: string;
  installedAt: string;
  source: string;
}

// ── Defensive parsing (untrusted CLI output) ──────────────────────────────────

/** typeof-string field or '' — never throws, never trusts a getter. */
function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Reduce an untrusted `source` (string OR nested object) to a flat display label
 * and a version guess. Renders as text; never executed.
 */
function sourceLabel(v: unknown): { source: string; version: string } {
  if (typeof v === 'string') return { source: v, version: '' };
  const obj = asObject(v);
  if (!obj) return { source: '', version: '' };
  const url = str(obj, 'url');
  const path = str(obj, 'path');
  const kind = str(obj, 'source');
  const ref = str(obj, 'ref');
  return { source: url || path || kind, version: ref };
}

/** Parse the `available` plugins out of `claude plugin list --available --json`.
 *  Every entry becomes a FRESH literal — untrusted objects are never spread or
 *  reused as keys, so a `__proto__` payload cannot pollute anything. */
export function parseAvailable(raw: unknown): MarketplacePlugin[] {
  const root = asObject(raw);
  const list = root ? root['available'] : undefined;
  if (!Array.isArray(list)) return [];
  const out: MarketplacePlugin[] = [];
  for (const item of list) {
    const obj = asObject(item);
    if (!obj) continue;
    const name = str(obj, 'name');
    const id = str(obj, 'pluginId') || name;
    if (id === '') continue;
    const { source, version } = sourceLabel(obj['source']);
    const countRaw = obj['installCount'];
    const plugin: MarketplacePlugin = {
      id,
      name,
      description: str(obj, 'description'),
      version,
      source,
      marketplace: str(obj, 'marketplaceName'),
    };
    if (typeof countRaw === 'number' && Number.isFinite(countRaw)) {
      plugin.installCount = countRaw;
    }
    out.push(plugin);
  }
  return out;
}

/** Parse installed plugins. Accepts either a bare array (`plugin list --json`)
 *  or the `{ installed: [...] }` shape (`--available`). Defensive on every field
 *  since names differ across CLI versions. */
export function parseInstalled(raw: unknown): InstalledPlugin[] {
  const root = asObject(raw);
  const list = Array.isArray(raw)
    ? raw
    : root && Array.isArray(root['installed'])
      ? root['installed']
      : [];
  const out: InstalledPlugin[] = [];
  for (const item of list) {
    const obj = asObject(item);
    if (!obj) continue;
    const name = str(obj, 'name');
    const id = str(obj, 'pluginId') || name;
    if (id === '') continue;
    const { source, version } = sourceLabel(obj['source']);
    out.push({
      id,
      name,
      version: str(obj, 'version') || version,
      scope: str(obj, 'scope'),
      installedAt: str(obj, 'installedAt') || str(obj, 'installedDate') || str(obj, 'date'),
      source,
    });
  }
  return out;
}

/** JSON.parse guarded — untrusted text may be truncated/garbage; never throws. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Distinguish a CLI-absent spawn failure from any other exec error. */
function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

function reasonFor(err: unknown): string {
  if (isEnoent(err)) return 'claude CLI not found';
  if (typeof err === 'object' && err !== null && (err as { killed?: unknown }).killed === true) {
    return 'claude CLI timed out';
  }
  return 'claude marketplace unavailable';
}

export function registerMarketplaceRoutes(app: Hono, config: MarketplaceRoutesConfig = {}): void {
  const exec = config.exec ?? defaultClaudeExec;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const jsonError = (status: 400 | 404, message: string): Response =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  // Run the FIXED marketplace-listing command and parse it. Any subprocess
  // failure (absent CLI, timeout, error) → typed { available:false }.
  const listing = async (): Promise<
    | { available: true; plugins: MarketplacePlugin[]; installed: InstalledPlugin[] }
    | { available: false; reason: string }
  > => {
    let res: ExecResult;
    try {
      res = await exec(['plugin', 'list', '--available', '--json'], { timeoutMs });
    } catch (err) {
      return { available: false, reason: reasonFor(err) };
    }
    const parsed = safeJson(res.stdout);
    if (parsed === undefined) {
      return { available: false, reason: 'could not read marketplace output' };
    }
    return { available: true, plugins: parseAvailable(parsed), installed: parseInstalled(parsed) };
  };

  // GET /api/marketplace — browse the marketplace (available plugins + install
  // counts) plus the installed set, from a single fixed-arg subprocess call.
  app.get('/api/marketplace', async (c) => c.json(await listing()));

  // GET /api/marketplace/installed — the installed plugins (version/scope/date).
  app.get('/api/marketplace/installed', async (c) => {
    let res: ExecResult;
    try {
      res = await exec(['plugin', 'list', '--json'], { timeoutMs });
    } catch (err) {
      return c.json({ available: false, reason: reasonFor(err) });
    }
    const parsed = safeJson(res.stdout);
    if (parsed === undefined) {
      return c.json({ available: false, reason: 'could not read installed output' });
    }
    return c.json({ available: true, installed: parseInstalled(parsed) });
  });

  // POST /api/marketplace/install { name } — one-click install.
  app.post('/api/marketplace/install', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(400, 'bad request');
    }
    const obj = asObject(body);
    const name = obj ? obj['name'] : undefined;
    if (typeof name !== 'string' || name === '') return jsonError(400, 'name required');

    // LAYER 1 — strict charset + length. Rejects every shell metacharacter
    // BEFORE any process is spawned. A name with `; | $() \`` never even reaches
    // the allowlist call, let alone `claude plugin install`.
    if (name.length > MAX_NAME_LEN || !NAME_CHARSET.test(name)) {
      return jsonError(400, 'invalid plugin name');
    }

    // LAYER 2 — allowlist. The name MUST be one the live marketplace listing
    // returned (its pluginId or name). CLI absent → graceful unavailable.
    const list = await listing();
    if (!list.available) return c.json(list);
    const allowed = list.plugins.some((p) => p.id === name || p.name === name);
    if (!allowed) return jsonError(404, 'unknown plugin');

    // Spawn the FIXED install command with the validated name as a POSITIONAL
    // arg (arg array, no shell). A non-ENOENT failure = the CLI rejected the
    // install → available:true, installed:false, with its (untrusted) message.
    try {
      // `--` end-of-options separator: even a charset-valid name can never be
      // interpreted as a flag by `claude` (defense in depth with the no-leading-
      // dash charset above).
      const res = await exec(['plugin', 'install', '--', name], { timeoutMs });
      const message = (res.stdout || res.stderr).trim().slice(0, 2000);
      return c.json({ available: true, installed: true, name, message });
    } catch (err) {
      if (isEnoent(err)) return c.json({ available: false, reason: 'claude CLI not found' });
      const message =
        typeof err === 'object' &&
        err !== null &&
        typeof (err as { stderr?: unknown }).stderr === 'string'
          ? (err as { stderr: string }).stderr.trim().slice(0, 2000)
          : reasonFor(err);
      return c.json({ available: true, installed: false, name, message });
    }
  });
}
