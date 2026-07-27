/**
 * git-routes — the GIT PANEL routes (SPEC §5 row 10, bead agentconfig-ngs.1).
 * Registered under `/api`, so every route INHERITS the hardened app's gates
 * (Host allowlist, bearer token, same-origin/CSRF); the state-changing POSTs are
 * thus CSRF-gated by the app, and this module adds only the subprocess trust
 * boundary described in ./git.ts.
 *
 * SCOPE: every route resolves `?instance=` (GET) / `body.instance` (POST)
 * against the registry — ONLY an already-registered instance, never an
 * attacker-chosen path — and pins the subprocess cwd to that instance's
 * realpath'd root. An unknown instance is a 404, never a scan/exec of an
 * arbitrary directory.
 *
 * GRACEFUL: git-absent → `{ gitAvailable:false }`; a non-repo dir →
 * `{ isRepo:false }`; an expected git failure (bad ref, no remote) →
 * `{ ok:false, message }`. None of these is a 500. Errors are constant and carry
 * only git's own message — no filesystem path oracle beyond that.
 */

import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { InstanceRegistry, RegistryInstance } from './registry.js';
import {
  DEFAULT_TIMEOUT_MS,
  LOG_FORMAT,
  LOG_LIMIT,
  NET_TIMEOUT_MS,
  classifyError,
  defaultGitExec,
  isValidMessage,
  isValidRef,
  isValidRepoPath,
  parseBranches,
  parseLog,
  parseStatus,
  validateFiles,
  type ExecResult,
  type GitExec,
} from './git.js';

export interface GitRoutesConfig {
  /** Resolves `?instance=`/`body.instance` to the repo-root scope. */
  registry: InstanceRegistry;
  /** Injectable `git` exec; defaults to the real subprocess (execFile, no shell). */
  exec?: GitExec;
  /** Per-call timeout for quick ops; defaults to 10s. */
  timeoutMs?: number;
  /** Network-op timeout for push/pull; defaults to 30s. */
  netTimeoutMs?: number;
}

function jsonError(status: 400 | 404, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A plain JSON object, or undefined for anything else. */
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Map a typed git failure to the wire shape shared by every route. */
function failureBody(err: unknown): Record<string, unknown> {
  const failure = classifyError(err);
  switch (failure.kind) {
    case 'absent':
      return { gitAvailable: false, isRepo: false };
    case 'not-repo':
      return { gitAvailable: true, isRepo: false };
    case 'timeout':
      return { gitAvailable: true, isRepo: true, ok: false, message: 'git timed out' };
    case 'error':
      return { gitAvailable: true, isRepo: true, ok: false, message: failure.message };
  }
}

export function registerGitRoutes(app: Hono, config: GitRoutesConfig): void {
  const registry = config.registry;
  const exec = config.exec ?? defaultGitExec;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const netTimeoutMs = config.netTimeoutMs ?? NET_TIMEOUT_MS;

  /** Resolve the instance from a query param; undefined ⇒ 404 caller-side. */
  const resolveQuery = (c: Context): RegistryInstance | undefined =>
    registry.resolve(new URL(c.req.url).searchParams.get('instance') ?? undefined);

  /** Read + resolve the instance from a POST body (returns the parsed body too). */
  const resolveBody = async (
    c: Context,
  ): Promise<{ instance?: RegistryInstance; body: Record<string, unknown> } | undefined> => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return undefined; // malformed body
    }
    const body = asObject(raw);
    if (!body) return undefined;
    const sel = typeof body['instance'] === 'string' ? (body['instance'] as string) : undefined;
    return { instance: registry.resolve(sel), body };
  };

  const run = (instance: RegistryInstance, args: string[], input?: string): Promise<ExecResult> =>
    exec(args, {
      cwd: instance.root,
      timeoutMs,
      ...(input !== undefined ? { input } : {}),
    });

  // GET /api/git/status?instance= — branch, ahead/behind, grouped changes.
  app.get('/api/git/status', async (c) => {
    const instance = resolveQuery(c);
    if (!instance) return jsonError(404, 'unknown instance');
    try {
      // core.quotePath=false → literal UTF-8 paths (never C-quoted).
      const res = await run(instance, [
        '-c',
        'core.quotePath=false',
        'status',
        '--porcelain=v2',
        '--branch',
      ]);
      return c.json({ gitAvailable: true, isRepo: true, ...parseStatus(res.stdout) });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // GET /api/git/log?instance= — the bounded commit timeline.
  app.get('/api/git/log', async (c) => {
    const instance = resolveQuery(c);
    if (!instance) return jsonError(404, 'unknown instance');
    try {
      const res = await run(instance, ['log', `--format=${LOG_FORMAT}`, `-n`, String(LOG_LIMIT)]);
      return c.json({ gitAvailable: true, isRepo: true, commits: parseLog(res.stdout) });
    } catch (err) {
      const failure = classifyError(err);
      // An empty repo (no commits yet) is not an error — just an empty timeline.
      if (failure.kind === 'error') {
        return c.json({ gitAvailable: true, isRepo: true, commits: [] });
      }
      return c.json(failureBody(err));
    }
  });

  // GET /api/git/branches?instance= — the branch list + current mark.
  app.get('/api/git/branches', async (c) => {
    const instance = resolveQuery(c);
    if (!instance) return jsonError(404, 'unknown instance');
    try {
      const res = await run(instance, ['branch', '--no-color']);
      return c.json({ gitAvailable: true, isRepo: true, branches: parseBranches(res.stdout) });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // GET /api/git/diff?instance=&path=&staged=1 — one file's unified diff TEXT.
  app.get('/api/git/diff', async (c) => {
    const instance = resolveQuery(c);
    if (!instance) return jsonError(404, 'unknown instance');
    const url = new URL(c.req.url);
    const file = url.searchParams.get('path') ?? '';
    if (!isValidRepoPath(instance.root, file)) return jsonError(400, 'invalid path');
    const staged = url.searchParams.get('staged') === '1';
    try {
      // `--` end-of-options: the validated path can never be read as a flag.
      const args = ['-c', 'core.quotePath=false', 'diff'];
      if (staged) args.push('--cached');
      args.push('--', file);
      const res = await run(instance, args);
      return c.json({ gitAvailable: true, isRepo: true, diff: res.stdout });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // POST /api/git/stage { instance?, files } — `git add -- <files>`.
  app.post('/api/git/stage', async (c) => {
    const resolved = await resolveBody(c);
    if (!resolved) return jsonError(400, 'bad request');
    if (!resolved.instance) return jsonError(404, 'unknown instance');
    const files = validateFiles(resolved.instance.root, resolved.body['files']);
    if (!files) return jsonError(400, 'invalid files');
    try {
      await run(resolved.instance, ['add', '--', ...files]);
      return c.json({ gitAvailable: true, isRepo: true, ok: true });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // POST /api/git/unstage { instance?, files } — `git restore --staged -- <files>`.
  app.post('/api/git/unstage', async (c) => {
    const resolved = await resolveBody(c);
    if (!resolved) return jsonError(400, 'bad request');
    if (!resolved.instance) return jsonError(404, 'unknown instance');
    const files = validateFiles(resolved.instance.root, resolved.body['files']);
    if (!files) return jsonError(400, 'invalid files');
    try {
      await run(resolved.instance, ['restore', '--staged', '--', ...files]);
      return c.json({ gitAvailable: true, isRepo: true, ok: true });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // POST /api/git/commit { instance?, message } — the message is piped on STDIN
  // via `git commit -F -`, so it never touches argv (a message with newlines,
  // `;`, `$()`, backticks is inert data). The conventional-commit helper builds
  // the message client-side; the server just commits the given string.
  app.post('/api/git/commit', async (c) => {
    const resolved = await resolveBody(c);
    if (!resolved) return jsonError(400, 'bad request');
    if (!resolved.instance) return jsonError(404, 'unknown instance');
    const message = resolved.body['message'];
    if (!isValidMessage(message)) return jsonError(400, 'invalid message');
    try {
      const res = await run(resolved.instance, ['commit', '-F', '-'], message);
      return c.json({
        gitAvailable: true,
        isRepo: true,
        ok: true,
        message: res.stdout.trim().slice(0, 2000),
      });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // POST /api/git/checkout { instance?, branch, create? } — switch or create a
  // branch. The ref is VALIDATED (no leading `-`, strict charset) and a trailing
  // `--` disambiguates it as a rev, never a pathspec.
  app.post('/api/git/checkout', async (c) => {
    const resolved = await resolveBody(c);
    if (!resolved) return jsonError(400, 'bad request');
    if (!resolved.instance) return jsonError(404, 'unknown instance');
    const branch = resolved.body['branch'];
    if (typeof branch !== 'string' || !isValidRef(branch)) return jsonError(400, 'invalid branch');
    const create = resolved.body['create'] === true;
    try {
      const args = create ? ['checkout', '-b', branch, '--'] : ['checkout', branch, '--'];
      const res = await run(resolved.instance, args);
      return c.json({
        gitAvailable: true,
        isRepo: true,
        ok: true,
        message: (res.stdout || res.stderr).trim().slice(0, 2000),
      });
    } catch (err) {
      return c.json(failureBody(err));
    }
  });

  // POST /api/git/push { instance? } — `git push` (upstream). Network op → longer
  // timeout; a missing remote / rejected push is a typed { ok:false }, not a 500.
  app.post('/api/git/push', (c) => netOp(c, 'push'));
  // POST /api/git/pull { instance? } — `git pull` (upstream).
  app.post('/api/git/pull', (c) => netOp(c, 'pull'));

  async function netOp(c: Context, verb: 'push' | 'pull'): Promise<Response> {
    const resolved = await resolveBody(c);
    if (!resolved) return jsonError(400, 'bad request');
    if (!resolved.instance) return jsonError(404, 'unknown instance');
    try {
      const res = await exec([verb], { cwd: resolved.instance.root, timeoutMs: netTimeoutMs });
      return c.json({
        gitAvailable: true,
        isRepo: true,
        ok: true,
        message: (res.stdout || res.stderr).trim().slice(0, 2000),
      });
    } catch (err) {
      return c.json(failureBody(err));
    }
  }
}
