/**
 * Adversarial in-process tests for the GIT PANEL routes (bead ngs.1). Requests go
 * straight into `app.fetch` (no socket); `git` is INJECTED as a fake exec (NEVER a
 * real subprocess), so the subprocess trust boundary is pinned at the application
 * layer alongside the INHERITED token + Origin/CSRF gates:
 *
 *  - the FIXED command + arg array (a malicious ref/path/message never reaches a
 *    shell — it is rejected by validation, or spawned only as an inert positional
 *    arg / stdin payload, always with a `--` end-of-options separator),
 *  - cwd is PINNED to the resolved instance's realpath'd repo root (the scope),
 *  - graceful git-absent (ENOENT → { gitAvailable:false }, never a 500),
 *  - graceful non-repo dir (→ { isRepo:false }) and timeout,
 *  - the commit message is piped on STDIN (`git commit -F -`) — a newline/`;`/`$()`
 *    message stays one inert value, never concatenated into a command,
 *  - status/log/branches parse from fake git output.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { GitExec, GitExecOpts, ExecResult } from './git.js';

const PORT = 8833;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'git-session-token-git-session-token-git-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-git-'));
fs.mkdirSync(path.join(base, 'project'), { recursive: true });
const projectRoot = fs.realpathSync(path.join(base, 'project'));

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

interface Call {
  args: string[];
  cwd: string;
  input?: string;
}

/** A fake `git` exec under full test control + a call log (args/cwd/stdin). */
function fakeExec(impl: (args: string[], opts: GitExecOpts) => Promise<ExecResult>): {
  exec: GitExec;
  calls: Call[];
} {
  const calls: Call[] = [];
  const exec: GitExec = (args, opts) => {
    const call: Call = { args: [...args], cwd: opts.cwd };
    if (opts.input !== undefined) call.input = opts.input;
    calls.push(call);
    return impl(args, opts);
  };
  return { exec, calls };
}

let instanceId = '';
function appWith(exec: GitExec): Hono {
  const registry = new InstanceRegistry('1.0.0');
  const inst = registry.seed(projectRoot, { makeDefault: true });
  instanceId = inst.id;
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    gitExec: exec,
  });
}

function get(app: Hono, pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH, ...headers } }),
    ),
  );
}

function post(
  app: Hono,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'POST',
        headers: {
          host: HOST,
          origin: ORIGIN,
          'content-type': 'application/json',
          ...AUTH,
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    ),
  );
}

const ENOENT = () =>
  Promise.reject(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
const NOT_REPO = () =>
  Promise.reject(
    Object.assign(new Error('exit 128'), {
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
    }),
  );

const STATUS_V2 = [
  '# branch.oid abc123',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaa bbb staged-mod.ts',
  '1 .M N... 100644 100644 100644 ccc ddd worktree-mod.ts',
  '1 A. N... 000000 100644 100644 000 eee added.ts',
  '1 .D N... 100644 100644 000000 fff 000 gone.ts',
  '2 R. N... 100644 100644 100644 hhh iii R100 new-name.ts\told-name.ts',
  '? untracked.ts',
  '',
].join('\n');

describe('GET /api/git/status', () => {
  it('runs the FIXED status command (arg array) in the instance repo root and parses groups', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: STATUS_V2, stderr: '' }));
    const res = await get(appWith(exec), '/api/git/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gitAvailable: boolean;
      isRepo: boolean;
      branch: string;
      ahead: number;
      behind: number;
      upstream: string;
      staged: { path: string; status: string }[];
      unstaged: { path: string; status: string }[];
      untracked: string[];
    };
    expect(body).toMatchObject({
      gitAvailable: true,
      isRepo: true,
      branch: 'main',
      ahead: 2,
      behind: 1,
    });
    expect(body.upstream).toBe('origin/main');
    // FIXED command + arg array; cwd PINNED to the realpath'd repo root.
    expect(calls[0]?.args).toEqual([
      '-c',
      'core.quotePath=false',
      'status',
      '--porcelain=v2',
      '--branch',
    ]);
    expect(calls[0]?.cwd).toBe(projectRoot);
    expect(body.staged.map((s) => s.path)).toEqual(['staged-mod.ts', 'added.ts', 'new-name.ts']);
    expect(body.unstaged.map((s) => s.path)).toEqual(['worktree-mod.ts', 'gone.ts']);
    expect(body.untracked).toEqual(['untracked.ts']);
  });

  it('degrades gracefully when git is absent (ENOENT → gitAvailable:false, not 500)', async () => {
    const { exec } = fakeExec(ENOENT);
    const res = await get(appWith(exec), '/api/git/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gitAvailable: boolean; isRepo: boolean };
    expect(body).toEqual({ gitAvailable: false, isRepo: false });
  });

  it('reports a non-repo dir as { isRepo:false } (not a 500)', async () => {
    const { exec } = fakeExec(NOT_REPO);
    const res = await get(appWith(exec), '/api/git/status');
    const body = (await res.json()) as { gitAvailable: boolean; isRepo: boolean };
    expect(body).toEqual({ gitAvailable: true, isRepo: false });
  });

  it('treats a killed/timed-out spawn as a typed failure, never hanging', async () => {
    const { exec } = fakeExec(() =>
      Promise.reject(Object.assign(new Error('t'), { killed: true })),
    );
    const res = await get(appWith(exec), '/api/git/status');
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBe('git timed out');
  });

  it('404s an unknown instance rather than exec-ing an arbitrary path', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    const res = await get(appWith(exec), '/api/git/status?instance=/etc');
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('GET /api/git/log', () => {
  const LOG = [
    'h1\x1fAda\x1f2026-01-01T00:00:00Z\x1ffeat: one\x1e',
    'h2\x1fBo\x1f2026-01-02T00:00:00Z\x1ffix: two\x1e',
  ].join('');
  it('runs a BOUNDED log and parses typed commits (subject as text)', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: LOG, stderr: '' }));
    const res = await get(appWith(exec), '/api/git/log');
    const body = (await res.json()) as { commits: { hash: string; subject: string }[] };
    expect(calls[0]?.args).toContain('-n');
    expect(calls[0]?.args).toContain('50');
    expect(body.commits).toHaveLength(2);
    expect(body.commits[0]).toMatchObject({ hash: 'h1', author: 'Ada', subject: 'feat: one' });
  });

  it('treats an empty repo (log error) as an empty timeline', async () => {
    const { exec } = fakeExec(() =>
      Promise.reject(
        Object.assign(new Error('128'), {
          stderr: "fatal: your current branch 'main' does not have any commits yet\n",
        }),
      ),
    );
    const res = await get(appWith(exec), '/api/git/log');
    const body = (await res.json()) as { commits: unknown[]; isRepo: boolean };
    expect(body.isRepo).toBe(true);
    expect(body.commits).toEqual([]);
  });
});

describe('GET /api/git/branches', () => {
  it('parses the branch list + current mark', async () => {
    const { exec } = fakeExec(() =>
      Promise.resolve({ stdout: '* main\n  feature/x\n', stderr: '' }),
    );
    const res = await get(appWith(exec), '/api/git/branches');
    const body = (await res.json()) as { branches: { name: string; current: boolean }[] };
    expect(body.branches).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
    ]);
  });
});

describe('POST /api/git/checkout — ref validation + flag injection', () => {
  it('rejects a leading-dash / metachar branch at validation — git is NEVER spawned', async () => {
    for (const evil of [
      '--force',
      '-x',
      'foo;rm -rf /',
      'foo$(id)',
      'foo`id`',
      'foo bar',
      'a..b',
      'foo\nbar',
    ]) {
      const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
      const res = await post(appWith(exec), '/api/git/checkout', { branch: evil });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it('switches a valid branch as a positional arg with a trailing `--` separator', async () => {
    const { exec, calls } = fakeExec(() =>
      Promise.resolve({ stdout: "Switched to branch 'feature/x'", stderr: '' }),
    );
    const res = await post(appWith(exec), '/api/git/checkout', { branch: 'feature/x' });
    expect(res.status).toBe(200);
    expect(calls[0]?.args).toEqual(['checkout', 'feature/x', '--']);
    expect(calls[0]?.cwd).toBe(projectRoot);
  });

  it('creates a branch with -b, still `--`-separated', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: 'ok', stderr: '' }));
    await post(appWith(exec), '/api/git/checkout', { branch: 'new-branch', create: true });
    expect(calls[0]?.args).toEqual(['checkout', '-b', 'new-branch', '--']);
  });
});

describe('POST /api/git/stage & unstage — path validation', () => {
  it('rejects a traversal / absolute / leading-dash path — no exec', async () => {
    for (const evil of ['../escape.ts', '/etc/passwd', '-rf', '../../secret']) {
      const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
      const res = await post(appWith(exec), '/api/git/stage', { files: [evil] });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it('stages valid in-repo paths after a `--` separator', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    const res = await post(appWith(exec), '/api/git/stage', { files: ['src/a.ts', 'src/b.ts'] });
    expect(res.status).toBe(200);
    expect(calls[0]?.args).toEqual(['add', '--', 'src/a.ts', 'src/b.ts']);
  });

  it('unstage uses `restore --staged --`', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    await post(appWith(exec), '/api/git/unstage', { files: ['src/a.ts'] });
    expect(calls[0]?.args).toEqual(['restore', '--staged', '--', 'src/a.ts']);
  });

  it('rejects an empty or non-array files list', async () => {
    const { exec } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    expect((await post(appWith(exec), '/api/git/stage', { files: [] })).status).toBe(400);
    expect((await post(appWith(exec), '/api/git/stage', { files: 'x' })).status).toBe(400);
  });
});

describe('POST /api/git/commit — message via stdin stays inert', () => {
  it('pipes a hostile message on STDIN as ONE value (never argv, never concatenated)', async () => {
    const message = 'feat: x\n\nbody with ; $(id) `whoami` && rm -rf / " \' newline\nmore';
    const { exec, calls } = fakeExec(() =>
      Promise.resolve({ stdout: '[main abc] feat: x', stderr: '' }),
    );
    const res = await post(appWith(exec), '/api/git/commit', { message });
    expect(res.status).toBe(200);
    // Message is NOT in argv — it is `-F -` (read from stdin), and the arg array
    // carries no piece of the message.
    expect(calls[0]?.args).toEqual(['commit', '-F', '-']);
    expect(calls[0]?.input).toBe(message);
    expect(calls[0]?.cwd).toBe(projectRoot);
  });

  it('rejects an empty/blank message', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    expect((await post(appWith(exec), '/api/git/commit', { message: '   ' })).status).toBe(400);
    expect((await post(appWith(exec), '/api/git/commit', { message: 5 })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a git commit failure as { ok:false }, not a 500', async () => {
    const { exec } = fakeExec(() =>
      Promise.reject(
        Object.assign(new Error('1'), { stderr: 'nothing to commit, working tree clean\n' }),
      ),
    );
    const res = await post(appWith(exec), '/api/git/commit', { message: 'feat: x' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain('nothing to commit');
  });
});

describe('POST /api/git/push & pull — network ops', () => {
  it('runs `git push` with a longer timeout; a missing remote is { ok:false }', async () => {
    const { exec, calls } = fakeExec(() =>
      Promise.reject(
        Object.assign(new Error('128'), { stderr: 'fatal: No configured push destination.\n' }),
      ),
    );
    const res = await post(appWith(exec), '/api/git/push', {});
    expect(res.status).toBe(200);
    expect(calls[0]?.args).toEqual(['push']);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain('No configured push destination');
  });

  it('runs `git pull`', async () => {
    const { exec, calls } = fakeExec(() =>
      Promise.resolve({ stdout: 'Already up to date.', stderr: '' }),
    );
    const res = await post(appWith(exec), '/api/git/pull', {});
    expect(res.status).toBe(200);
    expect(calls[0]?.args).toEqual(['pull']);
  });
});

describe('inherited gates', () => {
  it('401s a status read without a bearer token', async () => {
    const { exec } = fakeExec(() => Promise.resolve({ stdout: STATUS_V2, stderr: '' }));
    const res = await Promise.resolve(
      appWith(exec).fetch(
        new Request(`http://${HOST}/api/git/status`, { headers: { host: HOST } }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it('403s a cross-origin commit (CSRF gate)', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: '', stderr: '' }));
    const res = await post(
      appWith(exec),
      '/api/git/commit',
      { message: 'feat: x' },
      { origin: 'http://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('resolves the commit against the current instance id (cwd = its repo root)', async () => {
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: 'ok', stderr: '' }));
    const app = appWith(exec);
    const res = await post(app, '/api/git/commit', { instance: instanceId, message: 'feat: y' });
    expect(res.status).toBe(200);
    expect(calls[0]?.cwd).toBe(projectRoot);
  });
});
