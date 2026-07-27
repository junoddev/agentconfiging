/**
 * Tests for the SUGGESTED-projects route (bead qoc.3). The route module is
 * exercised on a BARE Hono app with an INJECTED `home` pointing at a temp
 * fixture — so the REAL claude adapter runs over controlled on-disk history with
 * no touch to the developer's `~/.claude`. The inherited token + Origin/CSRF
 * gates live in app.ts; one createApp probe here confirms the route is registered
 * UNDER those gates (401 without a token, before any disk read).
 *
 * The invariants pinned here (all SPEC §4.2 non-negotiables):
 *  - cwd is read from the session ENTRIES, never decoded from the lossy slug —
 *    one slug dir holding two distinct cwds (web.app vs web-app) yields BOTH real
 *    roots;
 *  - dedupe is on the resolved cwd (many sessions → one suggestion);
 *  - a cwd that no longer exists on disk is skipped;
 *  - an already-registered root is not suggested;
 *  - the read is bounded (most-recent N session files);
 *  - a missing home degrades to an empty list, not an error.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import {
  registerKnownProjectsRoute,
  type KnownProjectsResponse,
  type RootResolver,
} from './known-projects.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-known-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** Write one claude session file (JSONL) whose entries carry `cwd`. */
function writeSession(home: string, slug: string, id: string, cwd: string, atMs: number): void {
  const slugDir = path.join(home, 'projects', slug);
  fs.mkdirSync(slugDir, { recursive: true });
  const lines = [
    {
      type: 'user',
      sessionId: id,
      timestamp: iso(atMs),
      cwd,
      message: { role: 'user', content: 'x' },
    },
    { type: 'assistant', timestamp: iso(atMs), message: { role: 'assistant', content: [] } },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n');
  const file = path.join(slugDir, `${id}.jsonl`);
  fs.writeFileSync(file, lines);
  const t = new Date(atMs);
  fs.utimesSync(file, t, t);
}

/** A resolver that accepts every cwd as-is (existence decoupled from the fs). */
const acceptAll: RootResolver = (cwd) => Promise.resolve(cwd);

/** A resolver that accepts only an allowlist of roots (returns them verbatim). */
function acceptOnly(...roots: string[]): RootResolver {
  const ok = new Set(roots);
  return (cwd) => Promise.resolve(ok.has(cwd) ? cwd : undefined);
}

function appFor(
  home: string,
  opts: { registry?: InstanceRegistry; resolveRoot?: RootResolver; sessionCap?: number } = {},
): Hono {
  const app = new Hono();
  registerKnownProjectsRoute(app, {
    registry: opts.registry ?? new InstanceRegistry('0.0.0'),
    home,
    now: () => NOW,
    resolveRoot: opts.resolveRoot ?? acceptAll,
    ...(opts.sessionCap !== undefined ? { sessionCap: opts.sessionCap } : {}),
  });
  return app;
}

async function get(app: Hono): Promise<{ res: Response; body: KnownProjectsResponse }> {
  const res = await app.request('/api/known-projects');
  const body = (await res.json()) as KnownProjectsResponse;
  return { res, body };
}

describe('GET /api/known-projects', () => {
  it('reads cwd from session ENTRIES, not the lossy slug (web.app vs web-app collide)', async () => {
    const home = path.join(base, 'slug-collision');
    // ONE slug dir, two sessions with DISTINCT real cwds — the slug alone cannot
    // tell them apart, so a slug-decode would wrongly collapse them into one.
    writeSession(
      home,
      '-home-user-projects-web-app',
      's1',
      '/home/user/projects/web.app',
      NOW - 2000,
    );
    writeSession(
      home,
      '-home-user-projects-web-app',
      's2',
      '/home/user/projects/web-app',
      NOW - 1000,
    );
    const { res, body } = await get(appFor(home));
    expect(res.status).toBe(200);
    const roots = body.projects.map((p) => p.root).sort();
    expect(roots).toEqual(['/home/user/projects/web-app', '/home/user/projects/web.app']);
  });

  it('dedupes by resolved cwd across many sessions (count + last-seen)', async () => {
    const home = path.join(base, 'dedupe');
    writeSession(home, '-home-user-proj', 'a', '/home/user/proj', NOW - 5000);
    writeSession(home, '-home-user-proj', 'b', '/home/user/proj', NOW - 1000);
    writeSession(home, '-home-user-proj', 'c', '/home/user/proj', NOW - 9000);
    const { body } = await get(appFor(home));
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.root).toBe('/home/user/proj');
    expect(body.projects[0]!.sessionCount).toBe(3);
    // last-seen tracks the most-recent session mtime.
    expect(body.projects[0]!.lastSeen).toBe(iso(NOW - 1000));
  });

  it('skips a cwd that no longer exists on disk', async () => {
    const home = path.join(base, 'nonexistent');
    writeSession(home, '-a', 'a', '/gone/away', NOW - 1000);
    writeSession(home, '-b', 'b', '/still/here', NOW - 2000);
    const { body } = await get(appFor(home, { resolveRoot: acceptOnly('/still/here') }));
    expect(body.projects.map((p) => p.root)).toEqual(['/still/here']);
  });

  it('does not suggest an already-registered root', async () => {
    const home = path.join(base, 'registered');
    // Two real dirs. Both the registry and the DEFAULT resolver realpath their
    // roots, so the filter compares like-for-like: register one, suggest the other.
    const kept = fs.realpathSync(fs.mkdtempSync(path.join(base, 'kept-')));
    const added = fs.realpathSync(fs.mkdtempSync(path.join(base, 'added-')));
    writeSession(home, '-kept', 'k', kept, NOW - 1000);
    writeSession(home, '-added', 'a', added, NOW - 2000);
    const registry = new InstanceRegistry('0.0.0');
    registry.add(added); // realpath'd inside the registry
    const app = new Hono();
    registerKnownProjectsRoute(app, { registry, home, now: () => NOW });
    const { body } = await get(app);
    const roots = body.projects.map((p) => p.root);
    expect(roots).toContain(kept);
    expect(roots).not.toContain(added);
  });

  it('uses the DEFAULT realpath resolver to keep only existing dirs', async () => {
    const home = path.join(base, 'real-stat');
    const real = fs.mkdtempSync(path.join(base, 'realdir-'));
    writeSession(home, '-real', 'r', real, NOW - 1000);
    writeSession(home, '-fake', 'f', '/no/such/path/at/all', NOW - 2000);
    // No resolveRoot override → the real realpath-based resolver runs.
    const app = new Hono();
    registerKnownProjectsRoute(app, {
      registry: new InstanceRegistry('0.0.0'),
      home,
      now: () => NOW,
    });
    const { body } = await get(app);
    expect(body.projects.map((p) => p.root)).toEqual([fs.realpathSync(real)]);
  });

  it('bounds the read to the most-recent N session files', async () => {
    const home = path.join(base, 'bounded');
    writeSession(home, '-old', 'old', '/old/proj', NOW - 10_000);
    writeSession(home, '-new', 'new', '/new/proj', NOW - 1000);
    const { body } = await get(appFor(home, { sessionCap: 1 }));
    expect(body.sessionsTotal).toBe(2);
    expect(body.capped).toBe(true);
    // Only the most-recent file was read → only its cwd is suggested.
    expect(body.projects.map((p) => p.root)).toEqual(['/new/proj']);
  });

  it('degrades to an empty list when the home is missing', async () => {
    const { res, body } = await get(appFor(path.join(base, 'does-not-exist')));
    expect(res.status).toBe(200);
    expect(body.projects).toEqual([]);
    expect(body.sessionsTotal).toBe(0);
    expect(body.capped).toBe(false);
  });
});

describe('gate inheritance (createApp)', () => {
  const PORT = 8937;
  const TOKEN = 'known-session-token-known-session-token-known-1';
  const tokenHash = createHash('sha256').update(TOKEN).digest();

  it('serves /api/known-projects only under the bearer-token gate', async () => {
    const registry = new InstanceRegistry('0.0.0');
    registry.seed(base, { makeDefault: true });
    const app = createApp({
      tokenHash,
      port: () => PORT,
      distDir: base,
      registry,
      version: '0.0.0',
    });
    const res = await app.request('/api/known-projects', {
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(res.status).toBe(401); // no token → rejected before any disk read
  });
});
