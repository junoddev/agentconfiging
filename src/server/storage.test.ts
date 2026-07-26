/**
 * Adversarial in-process tests for the STORAGE API (bead agentconfig-wmc.2).
 * Requests go straight into `app.fetch` (no socket), pinning the disk-usage
 * breakdown, the safe-cleanup allowlist, symlink/containment discipline, and the
 * recoverable (trash, never unlink) behavior at the application layer. Every
 * input is treated as hostile.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { WriteScope } from './pathguard.js';

const PORT = 8790;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'storage-session-token-storage-session-token1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

// Layout:
//   base/
//     project/.claude/{logs,agents}   (project agent dir)
//     home/.claude/{logs,shell-snapshots,sessions,agents}  (global agent home)
//     escape/secret.txt               (out-of-scope symlink dest)
//     trash/                          (trash dir)
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-storage-'));
const projectRoot = path.join(base, 'project');
const globalRoot = path.join(base, 'home', '.claude');
const trashDir = path.join(base, 'trash');
const escapeDir = path.join(base, 'escape');

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

let scopes: WriteScope[];

function writeFileDeep(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function build() {
  fs.rmSync(base, { recursive: true, force: true });
  // Global agent home with a mix of runtime state (cleanable) and config/history.
  writeFileDeep(path.join(globalRoot, 'logs', 'a.log'), 'x'.repeat(1000));
  writeFileDeep(path.join(globalRoot, 'logs', 'b.log'), 'y'.repeat(500));
  writeFileDeep(path.join(globalRoot, 'shell-snapshots', 'snap.sh'), 'echo hi');
  writeFileDeep(path.join(globalRoot, 'sessions', 's1.json'), '{}'); // history, NOT cleanable
  writeFileDeep(path.join(globalRoot, 'agents', 'a.md'), '# agent'); // config, NOT cleanable
  // Project agent dir.
  writeFileDeep(path.join(projectRoot, '.claude', 'logs', 'p.log'), 'z'.repeat(200));
  writeFileDeep(path.join(projectRoot, '.claude', 'settings.json'), '{}');
  // Out-of-scope secret for the symlink-escape test.
  writeFileDeep(path.join(escapeDir, 'secret.txt'), 'SECRET');
  fs.mkdirSync(trashDir, { recursive: true });
  scopes = [
    { root: fs.realpathSync(projectRoot), kind: 'project' },
    { root: fs.realpathSync(globalRoot), kind: 'global' },
  ];
}

function app() {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    scopes,
    trashDir,
  });
}

function get(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app().fetch(
      new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH, ...headers } }),
    ),
  );
}

function post(
  pathname: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app().fetch(
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

interface Entry {
  name: string;
  bytes: number;
  files: number;
  safeToClean: boolean;
}
interface Home {
  key: string;
  scope: string;
  root: string;
  totalBytes: number;
  entries: Entry[];
}

beforeEach(build);

describe('GET /api/storage', () => {
  it('breaks down global + project homes with sizes and safeToClean flags', async () => {
    const res = await get('/api/storage');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { instance: string; homes: Home[] };
    const keys = json.homes.map((h) => h.key).sort();
    expect(keys).toContain('global:.claude');
    expect(keys).toContain('project:.claude');

    const globalHome = json.homes.find((h) => h.key === 'global:.claude');
    expect(globalHome).toBeDefined();
    const logs = globalHome?.entries.find((e) => e.name === 'logs');
    expect(logs?.safeToClean).toBe(true);
    expect(logs?.bytes).toBe(1500);
    expect(logs?.files).toBe(2);
    // Runtime state is cleanable; config + history are not.
    expect(globalHome?.entries.find((e) => e.name === 'shell-snapshots')?.safeToClean).toBe(true);
    expect(globalHome?.entries.find((e) => e.name === 'sessions')?.safeToClean).toBe(false);
    expect(globalHome?.entries.find((e) => e.name === 'agents')?.safeToClean).toBe(false);
    // Entries are sorted largest-first.
    expect(globalHome?.entries[0]?.name).toBe('logs');
  });

  it('requires the bearer token (inherited gate)', async () => {
    const res = await Promise.resolve(
      app().fetch(new Request(`http://${HOST}/api/storage`, { headers: { host: HOST } })),
    );
    expect(res.status).toBe(401);
  });

  it('404s an unknown instance selector (no fs scan)', async () => {
    const res = await get('/api/storage?instance=deadbeefdeadbeef');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/storage/cleanup — safe cleanup', () => {
  it('trashes an allowlisted subdir (recoverable) and removes it from disk', async () => {
    const logsDir = path.join(globalRoot, 'logs');
    expect(fs.existsSync(logsDir)).toBe(true);

    const res = await post('/api/storage/cleanup', { home: 'global:.claude', name: 'logs' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['cleaned']).toBe(true);
    expect(json['bytes']).toBe(1500);

    // Gone from the home…
    expect(fs.existsSync(logsDir)).toBe(false);
    // …but recoverable from trash.
    const trashedTo = String(json['trashedTo']);
    expect(fs.existsSync(trashedTo)).toBe(true);
    expect(fs.readdirSync(trashedTo).length).toBe(2); // both log files preserved
  });

  it('refuses a non-allowlisted (config/history) target — 403, nothing removed', async () => {
    const res = await post('/api/storage/cleanup', { home: 'global:.claude', name: 'agents' });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(globalRoot, 'agents'))).toBe(true);

    const res2 = await post('/api/storage/cleanup', { home: 'global:.claude', name: 'sessions' });
    expect(res2.status).toBe(403);
    expect(fs.existsSync(path.join(globalRoot, 'sessions'))).toBe(true);
  });

  it('refuses an unknown home key — 403', async () => {
    const res = await post('/api/storage/cleanup', { home: 'global:/etc', name: 'logs' });
    expect(res.status).toBe(403);
  });

  it('refuses a symlinked subdir rather than following it out of scope — 403', async () => {
    // Replace the cleanable `logs` with a symlink to an out-of-scope directory.
    fs.rmSync(path.join(globalRoot, 'logs'), { recursive: true, force: true });
    fs.symlinkSync(escapeDir, path.join(globalRoot, 'logs'));

    const res = await post('/api/storage/cleanup', { home: 'global:.claude', name: 'logs' });
    expect(res.status).toBe(403);
    // The escape target is untouched.
    expect(fs.existsSync(path.join(escapeDir, 'secret.txt'))).toBe(true);
  });

  it('404s an allowlisted subdir that does not exist', async () => {
    const res = await post('/api/storage/cleanup', { home: 'global:.claude', name: 'tmp' });
    expect(res.status).toBe(404);
  });

  it('requires same-origin proof for the state-changing POST (inherited CSRF gate)', async () => {
    const res = await Promise.resolve(
      app().fetch(
        new Request(`http://${HOST}/api/storage/cleanup`, {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
          body: JSON.stringify({ home: 'global:.claude', name: 'logs' }),
        }),
      ),
    );
    expect(res.status).toBe(403);
    // No Origin and no Sec-Fetch-Site → refused before any fs touch.
    expect(fs.existsSync(path.join(globalRoot, 'logs'))).toBe(true);
  });

  it('400s a malformed body', async () => {
    const res = await post('/api/storage/cleanup', { home: 'global:.claude' });
    expect(res.status).toBe(400);
  });
});
