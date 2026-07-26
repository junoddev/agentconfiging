/**
 * Adversarial in-process tests for the MARKETPLACE routes (bead 0zm.5). Requests
 * go straight into `app.fetch` (no socket); the `claude` CLI is INJECTED as a
 * fake exec (NEVER a real subprocess), so the subprocess trust boundary is pinned
 * at the application layer together with the INHERITED token + Origin/CSRF gates:
 *
 *  - the fixed command + arg array (a malicious install name never reaches a
 *    shell — it is rejected by validation, or spawned only as a positional arg),
 *  - graceful CLI-absent (ENOENT → { available:false }, never a 500),
 *  - timeout (a slow exec is aborted → unavailable),
 *  - untrusted output parsed safely (hostile JSON, `__proto__` → no pollution),
 *  - install validates the name against the live listing allowlist.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { ClaudeExec, ExecResult } from './marketplace.js';

const PORT = 8822;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'marketplace-session-token-marketplace-session-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-marketplace-'));
const projectRoot = path.join(base, 'project');
fs.mkdirSync(projectRoot, { recursive: true });

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** Records every exec call so tests can assert command + args (arg array). */
interface Call {
  args: string[];
}

/** A fake `claude` exec under full test control + a call log. */
function fakeExec(impl: (args: string[]) => Promise<ExecResult>): {
  exec: ClaudeExec;
  calls: Call[];
} {
  const calls: Call[] = [];
  const exec: ClaudeExec = (args) => {
    calls.push({ args: [...args] });
    return impl(args);
  };
  return { exec, calls };
}

const AVAILABLE_JSON = JSON.stringify({
  installed: [],
  available: [
    {
      pluginId: 'demo-plugin@claude-plugins-official',
      name: 'demo-plugin',
      description: 'a demo plugin <script>ignored as text</script>',
      marketplaceName: 'claude-plugins-official',
      source: { source: 'git-subdir', url: 'https://example.com/x.git', ref: 'v1.2.3' },
      installCount: 4242,
    },
    {
      pluginId: 'second@mp',
      name: 'second',
      description: 'another',
      marketplaceName: 'mp',
      source: './plugins/second',
      installCount: 7,
    },
  ],
});

function appWith(exec: ClaudeExec): Hono {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    marketplaceExec: exec,
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

const okExec = () => Promise.resolve({ stdout: AVAILABLE_JSON, stderr: '' });

describe('GET /api/marketplace', () => {
  it('runs the FIXED listing command with an arg array and parses plugins', async () => {
    const { exec, calls } = fakeExec(okExec);
    const res = await get(appWith(exec), '/api/marketplace');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      plugins: { id: string; name: string; installCount?: number; version: string }[];
    };
    expect(body.available).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['plugin', 'list', '--available', '--json']);
    expect(body.plugins).toHaveLength(2);
    expect(body.plugins[0]).toMatchObject({
      id: 'demo-plugin@claude-plugins-official',
      name: 'demo-plugin',
      installCount: 4242,
      version: 'v1.2.3',
    });
  });

  it('degrades gracefully when the CLI is absent (ENOENT → available:false, not 500)', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const { exec } = fakeExec(() => Promise.reject(enoent));
    const res = await get(appWith(exec), '/api/marketplace');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe('claude CLI not found');
  });

  it('treats a killed/timed-out spawn as unavailable, never hanging', async () => {
    const killed = Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' });
    const { exec } = fakeExec(() => Promise.reject(killed));
    const res = await get(appWith(exec), '/api/marketplace');
    const body = (await res.json()) as { available: boolean; reason: string };
    expect(body.available).toBe(false);
    expect(body.reason).toBe('claude CLI timed out');
  });

  it('parses hostile JSON safely — no prototype pollution', async () => {
    const hostile = JSON.stringify({
      available: [
        { pluginId: 'x@m', name: 'x', description: 'ok', __proto__: { polluted: true } },
        'not-an-object',
        null,
        { name: '' },
      ],
    });
    const { exec } = fakeExec(() => Promise.resolve({ stdout: hostile, stderr: '' }));
    const res = await get(appWith(exec), '/api/marketplace');
    const body = (await res.json()) as { plugins: { id: string }[] };
    // Only the one well-formed entry survives; junk/blank-id rows are dropped.
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0]?.id).toBe('x@m');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('returns available:false when the CLI emits non-JSON garbage', async () => {
    const { exec } = fakeExec(() => Promise.resolve({ stdout: 'not json{{', stderr: '' }));
    const res = await get(appWith(exec), '/api/marketplace');
    const body = (await res.json()) as { available: boolean };
    expect(body.available).toBe(false);
  });
});

describe('GET /api/marketplace/installed', () => {
  it('parses a bare installed array (version/scope/date, defensive)', async () => {
    const installed = JSON.stringify([
      { pluginId: 'a@m', name: 'a', version: '2.0.0', scope: 'user', installedAt: '2026-01-01' },
    ]);
    const { exec, calls } = fakeExec(() => Promise.resolve({ stdout: installed, stderr: '' }));
    const res = await get(appWith(exec), '/api/marketplace/installed');
    const body = (await res.json()) as {
      available: boolean;
      installed: { id: string; scope: string; version: string }[];
    };
    expect(calls[0]?.args).toEqual(['plugin', 'list', '--json']);
    expect(body.available).toBe(true);
    expect(body.installed[0]).toMatchObject({ id: 'a@m', scope: 'user', version: '2.0.0' });
  });
});

describe('POST /api/marketplace/install', () => {
  it('rejects a shell-metacharacter name at validation — install is NEVER spawned', async () => {
    for (const evil of [
      'demo; rm -rf /',
      'demo | cat /etc/passwd',
      'demo$(whoami)',
      'demo`id`',
      'demo && curl evil',
      'demo\nrm',
      'demo>out',
      'demo out',
    ]) {
      const { exec, calls } = fakeExec(okExec);
      const res = await post(appWith(exec), '/api/marketplace/install', { name: evil });
      expect(res.status).toBe(400);
      // Not even the listing runs for a charset-invalid name — zero subprocesses.
      expect(calls).toHaveLength(0);
    }
  });

  it('a traversal-shaped name is charset-valid but allowlist-rejected — install never spawned', async () => {
    // `.`, `/`, `-` are legal pluginId chars, so `../../etc/passwd` clears the
    // charset; the ALLOWLIST is what stops it. Either way `install` never runs.
    const { exec, calls } = fakeExec(okExec);
    const res = await post(appWith(exec), '/api/marketplace/install', {
      name: '../../etc/passwd',
    });
    expect(res.status).toBe(404);
    expect(calls.some((call) => call.args[1] === 'install')).toBe(false);
  });

  it('installs a name that is on the live listing allowlist (positional arg array)', async () => {
    const { exec, calls } = fakeExec((args) => {
      if (args[1] === 'install') return Promise.resolve({ stdout: 'installed', stderr: '' });
      return okExec();
    });
    const res = await post(appWith(exec), '/api/marketplace/install', {
      name: 'demo-plugin@claude-plugins-official',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; installed: boolean; name: string };
    expect(body).toMatchObject({ available: true, installed: true });
    const installCall = calls.find((call) => call.args[1] === 'install');
    expect(installCall?.args).toEqual([
      'plugin',
      'install',
      '--',
      'demo-plugin@claude-plugins-official',
    ]);
  });

  it('rejects a leading-dash name at validation — flag injection never spawns install', async () => {
    for (const flag of ['--force', '-x', '--help', '-rf']) {
      const { exec, calls } = fakeExec(okExec);
      const res = await post(appWith(exec), '/api/marketplace/install', { name: flag });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it('rejects a charset-valid name that is NOT in the listing (404 unknown plugin)', async () => {
    const { exec, calls } = fakeExec(okExec);
    const res = await post(appWith(exec), '/api/marketplace/install', { name: 'never-listed' });
    expect(res.status).toBe(404);
    // Listing ran (allowlist check), but install did NOT.
    expect(calls.some((call) => call.args[1] === 'install')).toBe(false);
  });

  it('is graceful when the CLI is absent during install', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const { exec } = fakeExec(() => Promise.reject(enoent));
    const res = await post(appWith(exec), '/api/marketplace/install', { name: 'demo-plugin' });
    const body = (await res.json()) as { available: boolean };
    expect(body.available).toBe(false);
  });

  it('requires a non-empty name', async () => {
    const { exec } = fakeExec(okExec);
    const res = await post(appWith(exec), '/api/marketplace/install', { name: '' });
    expect(res.status).toBe(400);
  });
});

describe('inherited gates', () => {
  it('401s without a bearer token', async () => {
    const { exec } = fakeExec(okExec);
    const res = await Promise.resolve(
      appWith(exec).fetch(
        new Request(`http://${HOST}/api/marketplace`, { headers: { host: HOST } }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it('403s a cross-origin install (CSRF gate)', async () => {
    const { exec } = fakeExec(okExec);
    const res = await post(
      appWith(exec),
      '/api/marketplace/install',
      { name: 'demo-plugin' },
      {
        origin: 'http://evil.example',
      },
    );
    expect(res.status).toBe(403);
  });
});
