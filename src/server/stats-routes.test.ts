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

/** A real AWS-style secret planted in session CONTENT; it must be redacted. */
const PLANTED_SECRET = 'AKIAIOSFODNN7EXAMPLE';

/**
 * A home whose one session exercises every replay concern: a user text block
 * carrying a planted secret, an assistant with thinking + tool_use + tool_result
 * blocks, and a sidechain (subagent) message. `count` extra plain messages let
 * pagination be tested.
 */
function makeReplayHome(name: string, count = 0): string {
  const home = path.join(base, name);
  const slug = path.join(home, 'projects', '-home-user-proj');
  fs.mkdirSync(slug, { recursive: true });

  const lines: unknown[] = [
    { type: 'ai-title', aiTitle: 'Replay <b>run</b>', sessionId: 'rep-1' },
    {
      type: 'user',
      sessionId: 'rep-1',
      timestamp: iso(NOW - 10_000),
      cwd: '/home/user/proj',
      message: { role: 'user', content: `deploy with key ${PLANTED_SECRET} now` },
    },
    {
      type: 'assistant',
      sessionId: 'rep-1',
      timestamp: iso(NOW - 9000),
      message: {
        role: 'assistant',
        model: 'claude-x',
        content: [
          { type: 'thinking', thinking: `secret is ${PLANTED_SECRET}` },
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: PLANTED_SECRET } },
          { type: 'tool_result', tool_use_id: 'tu-1', content: `output ${PLANTED_SECRET} done` },
        ],
      },
    },
    {
      type: 'user',
      sessionId: 'rep-1',
      timestamp: iso(NOW - 8000),
      isSidechain: true,
      message: { role: 'user', content: 'subagent step' },
    },
  ];
  for (let i = 0; i < count; i++) {
    lines.push({
      type: 'user',
      sessionId: 'rep-1',
      timestamp: iso(NOW - 7000 + i),
      message: { role: 'user', content: `msg ${i}` },
    });
  }
  fs.writeFileSync(path.join(slug, 'rep-1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n'));
  // Pin the mtime deterministically (10s before NOW) so live detection is
  // testable against the injected clock rather than the real wall clock.
  const at = new Date(NOW - 10_000);
  fs.utimesSync(path.join(slug, 'rep-1.jsonl'), at, at);
  return home;
}

/** A bare app (no gates) with the stats routes over a fixture home. */
function appFor(
  home: string,
  opts: {
    sessionCap?: number;
    now?: () => number;
    liveWindowMs?: number;
    pageSize?: number;
    stateDir?: string;
  } = {},
): Hono {
  const app = new Hono();
  registerStatsRoutes(app, {
    home,
    now: opts.now ?? (() => NOW),
    sessionCap: opts.sessionCap,
    ttlMs: 0,
    liveWindowMs: opts.liveWindowMs,
    pageSize: opts.pageSize,
    stateDir: opts.stateDir,
  });
  return app;
}

const get = (app: Hono, url: string) => app.request(url);
const post = (app: Hono, url: string, body: unknown) =>
  app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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

describe('GET /api/sessions (live + tags)', () => {
  it('flags a recently-appended session as live', async () => {
    // rep-1's newest message is NOW - 8000; a 60s window makes it live.
    const app = appFor(makeReplayHome('sessions-live'), { liveWindowMs: 60_000 });
    const body = await (await get(app, '/api/sessions')).json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].live).toBe(true);
    expect(body.sessions[0].tags).toEqual([]);
  });

  it('does not flag an old session when the live window is tiny', async () => {
    const app = appFor(makeReplayHome('sessions-notlive'), { liveWindowMs: 1 });
    const body = await (await get(app, '/api/sessions')).json();
    expect(body.sessions[0].live).toBe(false);
  });
});

describe('GET /api/sessions/:id (replay detail)', () => {
  it('redacts every secret-bearing content string server-side', async () => {
    const app = appFor(makeReplayHome('detail-redact'));
    const res = await get(app, '/api/sessions/rep-1');
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The planted secret NEVER crosses the wire, in any block kind.
    expect(raw).not.toContain(PLANTED_SECRET);
    expect(raw).toContain('[REDACTED:aws_access_key]');

    const body = JSON.parse(raw);
    expect(body.id).toBe('rep-1');
    expect(body.messageCount).toBe(3);
    // Adversarial title preserved as DATA, not executed.
    expect(body.title).toBe('Replay <b>run</b>');

    const user = body.messages[0];
    expect(user.blocks[0].kind).toBe('text');
    expect(user.blocks[0].text).toContain('[REDACTED:aws_access_key]');
    expect(user.blocks[0].spans.length).toBeGreaterThan(0);

    const assistant = body.messages[1];
    const kinds = assistant.blocks.map((b: { kind: string }) => b.kind);
    expect(kinds).toEqual(['thinking', 'tool_use', 'tool_result']);
    // Redacted thinking + tool_result text.
    expect(assistant.blocks[0].text).toContain('[REDACTED:aws_access_key]');
    expect(assistant.blocks[2].text).toContain('[REDACTED:aws_access_key]');
    // tool_use surfaces only structural fields — NEVER its (secret) input.
    expect(assistant.blocks[1]).not.toHaveProperty('input');
    expect(assistant.blocks[1].name).toBe('Bash');

    // Sidechain (subagent) message is flagged distinctly.
    expect(body.messages[2].isSidechain).toBe(true);
  });

  it('refuses a traversal-shaped / unknown id (no arbitrary file read)', async () => {
    const app = appFor(makeReplayHome('detail-guard'));
    for (const id of ['..%2F..%2Fetc%2Fpasswd', 'nope', '..']) {
      const res = await get(app, `/api/sessions/${id}`);
      expect(res.status).toBe(404);
    }
  });

  it('paginates a large session (windowed page + total)', async () => {
    const app = appFor(makeReplayHome('detail-page', 20), { pageSize: 5 });
    const first = await (await get(app, '/api/sessions/rep-1')).json();
    expect(first.messageCount).toBe(23); // 3 base + 20 extra
    expect(first.messages).toHaveLength(5);
    expect(first.offset).toBe(0);
    expect(first.limit).toBe(5);

    const page2 = await (await get(app, '/api/sessions/rep-1?offset=5&limit=10')).json();
    expect(page2.messages).toHaveLength(10);
    expect(page2.offset).toBe(5);

    // limit is clamped to MAX_PAGE_SIZE.
    const huge = await (await get(app, '/api/sessions/rep-1?limit=99999')).json();
    expect(huge.limit).toBe(500);
  });
});

describe('POST /api/sessions/:id/tags', () => {
  it('stores sanitized tags in the local sidecar and lists them', async () => {
    const stateDir = fs.mkdtempSync(path.join(base, 'tags-'));
    const home = makeReplayHome('tags-store');
    const app = appFor(home, { stateDir });

    const res = await post(app, '/api/sessions/rep-1/tags', {
      tags: ['  urgent  ', 'urgent', '', 'review', 42],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Trimmed, deduped, non-strings dropped.
    expect(body).toEqual({ id: 'rep-1', tags: ['urgent', 'review'] });

    // Sidecar persisted; the list route surfaces the tags.
    const listApp = appFor(home, { stateDir });
    const list = await (await get(listApp, '/api/sessions')).json();
    expect(list.sessions[0].tags).toEqual(['urgent', 'review']);
    // And the detail route.
    const detail = await (await get(listApp, '/api/sessions/rep-1')).json();
    expect(detail.tags).toEqual(['urgent', 'review']);
  });

  it('caps the tag count and each tag length', async () => {
    const stateDir = fs.mkdtempSync(path.join(base, 'tags-cap-'));
    const app = appFor(makeReplayHome('tags-cap'), { stateDir });
    const many = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const body = await (await post(app, '/api/sessions/rep-1/tags', { tags: many })).json();
    expect(body.tags.length).toBe(32);

    const long = 'x'.repeat(200);
    const body2 = await (await post(app, '/api/sessions/rep-1/tags', { tags: [long] })).json();
    expect(body2.tags[0].length).toBe(64);
  });

  it('refuses tags for an unknown id (404)', async () => {
    const stateDir = fs.mkdtempSync(path.join(base, 'tags-404-'));
    const app = appFor(makeReplayHome('tags-404'), { stateDir });
    const res = await post(app, '/api/sessions/nope/tags', { tags: ['x'] });
    expect(res.status).toBe(404);
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
