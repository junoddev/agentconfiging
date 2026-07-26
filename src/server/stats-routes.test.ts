/**
 * Tests for the read-only DASHBOARD routes (bead 7yb.2). The route module is
 * exercised on a BARE Hono app with an INJECTED `home` pointing at a temp
 * fixture — so the REAL claude adapter runs over controlled on-disk history with
 * no touch to the developer's `~/.claude`. The inherited token + Origin/CSRF
 * gates live in app.ts and are covered by app/security tests; one createApp probe
 * here confirms /api/stats is registered UNDER those gates (401 without a token,
 * which returns before any disk read).
 *
 * The invariants pinned here: aggregate + metadata-only responses that are
 * CONTENT-FREE (no message body ever leaks), the session CAP (most-recent N),
 * resilience to a missing home (zeroed stats, not an error), and the shared
 * cache + invalidate seam.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { registerStatsRoutes, sessionSummary, StatsCache } from './stats-routes.js';
import { parseClaudeSession } from '../core/index.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A message body string that must NEVER appear in any served response. */
const SECRET_BODY = 'SECRET_MESSAGE_BODY_DO_NOT_LEAK';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-stats-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** Build a claude home dir with two session files + a prompt history. */
function makeHome(name: string): string {
  const home = path.join(base, name);
  const slug = path.join(home, 'projects', '-home-user-proj');
  fs.mkdirSync(slug, { recursive: true });

  const sessionA = [
    { type: 'ai-title', aiTitle: 'Alpha <script>alert(1)</script>', sessionId: 'sess-a' },
    {
      type: 'user',
      sessionId: 'sess-a',
      timestamp: iso(NOW - DAY),
      cwd: '/home/user/proj',
      message: { role: 'user', content: SECRET_BODY },
    },
    {
      type: 'assistant',
      timestamp: iso(NOW - DAY + 60_000),
      message: { role: 'assistant', content: [{ type: 'text', text: SECRET_BODY }] },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n');

  const sessionB = [
    { type: 'summary', summary: 'Beta session' },
    {
      type: 'user',
      sessionId: 'sess-b',
      timestamp: iso(NOW),
      cwd: '/home/user/proj',
      message: { role: 'user', content: SECRET_BODY },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n');

  fs.writeFileSync(path.join(slug, 'sess-a.jsonl'), sessionA);
  fs.writeFileSync(path.join(slug, 'sess-b.jsonl'), sessionB);
  // sess-b is the most recent so the cap keeps it first.
  const later = new Date(NOW + 1000);
  fs.utimesSync(path.join(slug, 'sess-b.jsonl'), later, later);
  const earlier = new Date(NOW - DAY);
  fs.utimesSync(path.join(slug, 'sess-a.jsonl'), earlier, earlier);

  fs.writeFileSync(
    path.join(home, 'history.jsonl'),
    [
      JSON.stringify({
        display: 'a typed prompt',
        timestamp: NOW - DAY,
        project: '/home/user/proj',
      }),
      JSON.stringify({ display: 'another prompt', timestamp: NOW }),
    ].join('\n'),
  );
  return home;
}

/** A bare app (no gates) with the stats routes over a fixture home. */
function appFor(home: string, opts: { sessionCap?: number } = {}): Hono {
  const app = new Hono();
  registerStatsRoutes(app, { home, now: () => NOW, sessionCap: opts.sessionCap, ttlMs: 0 });
  return app;
}

const get = (app: Hono, url: string) => app.request(url);

describe('GET /api/stats', () => {
  it('returns aggregate stats + achievement metadata, content-free', async () => {
    const app = appFor(makeHome('stats-basic'));
    const res = await get(app, '/api/stats');
    expect(res.status).toBe(200);
    const raw = await res.text();
    // No message body ever appears in the aggregate response.
    expect(raw).not.toContain(SECRET_BODY);

    const body = JSON.parse(raw);
    expect(body.stats.sessionCount).toBe(2);
    expect(body.stats.messageCounts.total).toBe(3);
    expect(body.stats.promptCount).toBe(2);
    expect(body.sessionsScanned).toBe(2);
    expect(body.sessionsTotal).toBe(2);
    expect(body.capped).toBe(false);

    // Achievement metadata only — never the criterion predicate.
    const ids = body.achievements.unlocked.map((a: { id: string }) => a.id);
    expect(ids).toContain('first-session');
    for (const a of [...body.achievements.unlocked, ...body.achievements.locked]) {
      expect(a).not.toHaveProperty('criterion');
      expect(Object.keys(a).sort()).toEqual(['category', 'description', 'id', 'name']);
    }
  });

  it('caps the most-recent N session files and flags the window', async () => {
    const app = appFor(makeHome('stats-cap'), { sessionCap: 1 });
    const body = await (await get(app, '/api/stats')).json();
    expect(body.sessionsScanned).toBe(1);
    expect(body.sessionsTotal).toBe(2);
    expect(body.capped).toBe(true);
    // Only the most-recent session (sess-b, 1 message) is counted.
    expect(body.stats.sessionCount).toBe(1);
    expect(body.stats.messageCounts.total).toBe(1);
  });

  it('is resilient to a missing home (zeroed stats, not an error)', async () => {
    const app = appFor(path.join(base, 'does-not-exist'));
    const res = await get(app, '/api/stats');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stats.sessionCount).toBe(0);
    expect(body.stats.messageCounts.total).toBe(0);
    expect(body.achievements.unlocked).toHaveLength(0);
    expect(body.achievements.locked.length).toBeGreaterThan(0);
  });
});

describe('GET /api/sessions', () => {
  it('lists content-free session metadata, most-recent first', async () => {
    const app = appFor(makeHome('sessions-list'));
    const res = await get(app, '/api/sessions');
    const raw = await res.text();
    expect(raw).not.toContain(SECRET_BODY);

    const body = JSON.parse(raw);
    expect(body.sessions).toHaveLength(2);
    // sess-b (NOW) sorts before sess-a (NOW - DAY).
    expect(body.sessions[0].id).toBe('sess-b');
    expect(body.sessions[1].id).toBe('sess-a');
    // Adversarial title text is preserved as DATA (a string), not executed.
    expect(body.sessions[1].title).toBe('Alpha <script>alert(1)</script>');
    expect(body.sessions[1].messageCount).toBe(2);
    expect(body.sessions[1].cwd).toBe('/home/user/proj');
    // No message bodies on any summary.
    for (const s of body.sessions) {
      expect(s).not.toHaveProperty('messages');
      expect(s).not.toHaveProperty('content');
    }
  });
});

describe('sessionSummary', () => {
  it('reduces a session to metadata with a computed runtimeMs', () => {
    const text = [
      { type: 'ai-title', aiTitle: 'T', sessionId: 's1' },
      { type: 'user', timestamp: iso(NOW), cwd: '/w', message: { role: 'user', content: 'x' } },
      {
        type: 'assistant',
        timestamp: iso(NOW + 5000),
        message: { role: 'assistant', content: 'y' },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const summary = sessionSummary(parseClaudeSession(text, '/p/s1.jsonl'));
    expect(summary.id).toBe('s1');
    expect(summary.title).toBe('T');
    expect(summary.messageCount).toBe(2);
    expect(summary.runtimeMs).toBe(5000);
  });
});

describe('StatsCache', () => {
  it('reuses a read within the TTL and re-reads after invalidate', async () => {
    const cache = new StatsCache(makeHome('cache'), 400, 60_000);
    const first = await cache.load(NOW);
    const second = await cache.load(NOW + 1000);
    expect(second).toBe(first); // same object → no re-read within TTL
    cache.invalidate();
    const third = await cache.load(NOW + 2000);
    expect(third).not.toBe(first); // fresh read after invalidate
    expect(third.sessions.length).toBe(first.sessions.length);
  });
});

describe('gate inheritance (createApp)', () => {
  const PORT = 8931;
  const TOKEN = 'stats-session-token-stats-session-token-stats-1';
  const tokenHash = createHash('sha256').update(TOKEN).digest();

  it('serves /api/stats only under the bearer-token gate', async () => {
    const registry = new InstanceRegistry('0.0.0');
    registry.seed(base, { makeDefault: true });
    const app = createApp({
      tokenHash,
      port: () => PORT,
      distDir: base,
      registry,
      version: '0.0.0',
    });
    const res = await app.request('/api/stats', {
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(res.status).toBe(401); // no token → rejected before any disk read
  });
});
