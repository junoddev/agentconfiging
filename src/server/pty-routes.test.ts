/**
 * GET /api/pty/status tests (bead agentconfig-ngs.2). Requests go straight into
 * `app.fetch` (no socket). The route INHERITS the hardened app's gates (token +
 * Origin), and reports the terminal capability WITHOUT ever loading a real native
 * module: the PtyManager's loader is INJECTED. We pin the three states —
 * interactive + module present (available, with the validated shell choices),
 * daemon mode (unavailable), and node-pty absent (unavailable) — and that a
 * missing token is still a 401.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { PtyManager, type PtySpawner } from './pty.js';
import type { ReportStore } from './store.js';
import type { PtyStatus } from './pty-routes.js';

const PORT = 8844;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'pty-routes-token-pty-routes-token-pty-rt-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}`, host: HOST, origin: ORIGIN };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-ptyroutes-'));
const projectRoot = fs.realpathSync(base);
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** A no-op fake spawner (loaded but never actually used by the status route). */
const fakeSpawner: PtySpawner = {
  spawn() {
    throw new Error('status route must never spawn');
  },
};

function registryWith(kinds: string[]): InstanceRegistry {
  const registry = new InstanceRegistry('1.0.0', (root) => {
    const fake = {
      get: () => ({ root, scope: 'project', agents: kinds.map((kind) => ({ kind })) }) as unknown,
      invalidate: () => undefined,
    };
    return fake as unknown as ReportStore;
  });
  registry.seed(projectRoot, { makeDefault: true });
  return registry;
}

function appWith(manager: PtyManager, registry: InstanceRegistry = registryWith([])): Hono {
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    interactive: manager.interactive,
    ptyManager: manager,
  });
}

const req = (path: string): Request => new Request(`http://${HOST}${path}`, { headers: AUTH });

describe('GET /api/pty/status', () => {
  it('interactive + node-pty present → available with the shell choices', async () => {
    const manager = new PtyManager({
      interactive: true,
      loader: () => Promise.resolve(fakeSpawner),
      env: { SHELL: '/bin/bash' } as NodeJS.ProcessEnv,
      platform: 'linux',
    });
    const app = appWith(manager, registryWith(['claude-code', 'cursor']));
    const body = (await (await app.fetch(req('/api/pty/status'))).json()) as PtyStatus;
    expect(body.available).toBe(true);
    expect(body.interactive).toBe(true);
    // The plain shell, plus the detected + allowlisted CLI (cursor excluded).
    expect(body.shells.map((s) => s.id)).toEqual(['shell', 'cli:claude-code']);
  });

  it('daemon mode (interactive:false) → unavailable, empty shells, a reason', async () => {
    const manager = new PtyManager({
      interactive: false,
      loader: () => Promise.resolve(fakeSpawner),
    });
    const app = appWith(manager);
    const body = (await (await app.fetch(req('/api/pty/status'))).json()) as PtyStatus;
    expect(body).toMatchObject({ available: false, interactive: false, shells: [] });
    expect(body.reason).toBeTruthy();
  });

  it('node-pty absent (null loader) → unavailable, server still answers', async () => {
    const manager = new PtyManager({
      interactive: true,
      loader: () => Promise.resolve(null),
    });
    const app = appWith(manager);
    const body = (await (await app.fetch(req('/api/pty/status'))).json()) as PtyStatus;
    expect(body).toMatchObject({ available: false, interactive: true, shells: [] });
    expect(body.reason).toBeTruthy();
  });

  it('still requires the bearer token (inherits the /api gate) → 401', async () => {
    const manager = new PtyManager({
      interactive: true,
      loader: () => Promise.resolve(fakeSpawner),
    });
    const app = appWith(manager);
    const res = await app.fetch(
      new Request(`http://${HOST}/api/pty/status`, { headers: { host: HOST } }),
    );
    expect(res.status).toBe(401);
  });
});
