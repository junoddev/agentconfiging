/**
 * Tests for the read-only ANALYTICS route (bead 7yb.5). The route module is
 * exercised on a BARE Hono app with an INJECTED `home` pointing at a temp
 * fixture — so the REAL claude adapter runs over controlled on-disk history with
 * no touch to the developer's `~/.claude`. The inherited token + Origin/CSRF
 * gates live in app.ts and are covered by app/security tests.
 *
 * Invariants pinned here: token/cost aggregates computed from the logged usage
 * blocks, a CONTENT-FREE response (no message body ever leaks), and resilience to
 * a missing home (zeroed analytics, not an error).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerAnalyticsRoutes, type AnalyticsResponse } from './analytics-routes.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** A message body string that must NEVER appear in any served response. */
const SECRET_BODY = 'SECRET_MESSAGE_BODY_DO_NOT_LEAK';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-analytics-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** Build a claude home with one usage-bearing session file. */
function makeHome(name: string): string {
  const home = path.join(base, name);
  const slug = path.join(home, 'projects', '-home-user-proj');
  fs.mkdirSync(slug, { recursive: true });
  const lines = [
    {
      type: 'user',
      sessionId: 'sess-a',
      timestamp: iso(NOW),
      cwd: '/home/user/proj',
      message: { role: 'user', content: SECRET_BODY },
    },
    {
      type: 'assistant',
      timestamp: iso(NOW),
      message: {
        role: 'assistant',
        model: 'claude-opus-4-5',
        content: [{ type: 'text', text: SECRET_BODY }],
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 500_000,
        },
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n');
  fs.writeFileSync(path.join(slug, 'sess-a.jsonl'), lines);
  return home;
}

function appFor(home: string): Hono {
  const app = new Hono();
  registerAnalyticsRoutes(app, { home, now: () => NOW });
  return app;
}

async function getAnalytics(app: Hono): Promise<{ res: Response; body: AnalyticsResponse }> {
  const res = await app.request('/api/analytics');
  const body = (await res.json()) as AnalyticsResponse;
  return { res, body };
}

describe('GET /api/analytics', () => {
  it('computes token + cost aggregates per model from the logged usage', async () => {
    const { res, body } = await getAnalytics(appFor(makeHome('has-usage')));
    expect(res.status).toBe(200);
    expect(body.models).toHaveLength(1);
    expect(body.models[0]!.model).toBe('claude-opus-4-5');
    // opus: 1M input * $15 + 100k output * $75/1e6 + 500k cacheRead * $1.5/1e6
    // = 15 + 7.5 + 0.75 = 23.25
    expect(body.models[0]!.cost.total).toBeCloseTo(23.25, 4);
    expect(body.totalCost).toBeCloseTo(23.25, 4);
    expect(body.totals.inputTokens).toBe(1_000_000);
    // cacheRead 500k / (input 1M + cacheRead 500k) = 1/3
    expect(body.cacheEfficiency).toBeCloseTo(1 / 3, 4);
    expect(body.currentMonth).toBe('2026-07');
    expect(body.currentMonthCost).toBeCloseTo(23.25, 4);
    expect(body.sessionsScanned).toBe(1);
    expect(body.capped).toBe(false);
  });

  it('never leaks a message body (content-free response)', async () => {
    const { body } = await getAnalytics(appFor(makeHome('no-leak')));
    expect(JSON.stringify(body)).not.toContain(SECRET_BODY);
  });

  it('degrades to zeroed analytics when the home is missing', async () => {
    const { res, body } = await getAnalytics(appFor(path.join(base, 'does-not-exist')));
    expect(res.status).toBe(200);
    expect(body.totalCost).toBe(0);
    expect(body.models).toEqual([]);
    expect(body.hourly).toHaveLength(24);
    expect(body.planNote).toContain('API-equivalent');
  });
});
