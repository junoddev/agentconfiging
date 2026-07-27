/**
 * Adversarial in-process tests for the SCHEDULE route (bead ira.4), which lives
 * on the pipeline-routes surface: GET/POST /api/pipelines/:id/schedule. Requests
 * go straight into `app.fetch`. Pinned here: get/set round-trip + computed
 * next-run, cron VALIDATION (an invalid cron is a 400, never persisted), the
 * pipeline-must-exist + instance-must-resolve guards, and the INHERITED token +
 * Origin/CSRF gates on the state-changing POST.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import type { Pipeline } from '../core/pipeline/index.js';

const PORT = 8843;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sched-session-token-sched-session-token-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sched-'));
fs.mkdirSync(path.join(baseDir, 'project'), { recursive: true });
const projectRoot = fs.realpathSync(path.join(baseDir, 'project'));
afterAll(() => fs.rmSync(baseDir, { recursive: true, force: true }));

function freshStateDir(): string {
  return fs.mkdtempSync(path.join(baseDir, 'state-'));
}

function appWith(stateDir: string): Hono {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(baseDir, 'nodist'),
    registry,
    version: '1.0.0',
    pipelineStateDir: stateDir,
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
  headers: Record<string, string> = { origin: ORIGIN },
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...AUTH, ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function validPipeline(id = 'demo'): Pipeline {
  return {
    id,
    name: 'Demo',
    nodes: [
      { id: 'in', name: 'In', type: 'input' } as Pipeline['nodes'][number],
      { id: 'out', name: 'Out', type: 'output' } as Pipeline['nodes'][number],
    ],
    edges: [{ from: 'in', to: 'out' }],
  };
}

async function savePipeline(app: Hono, pipeline: Pipeline): Promise<void> {
  const res = await post(app, '/api/pipelines', pipeline);
  expect(res.status).toBe(200);
}

describe('GET/POST /api/pipelines/:id/schedule', () => {
  it('returns null before any schedule is set', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const res = await get(app, '/api/pipelines/demo/schedule');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schedule: null, nextRun: null });
  });

  it('saves a schedule and round-trips it with a computed next-run', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const setRes = await post(app, '/api/pipelines/demo/schedule', {
      cron: '@daily',
      enabled: true,
    });
    expect(setRes.status).toBe(200);
    const saved = (await setRes.json()) as {
      schedule: { cron: string; enabled: boolean; instanceRoot: string };
      nextRun: number | null;
    };
    expect(saved.schedule.cron).toBe('@daily');
    expect(saved.schedule.enabled).toBe(true);
    expect(saved.schedule.instanceRoot).toBe(projectRoot);
    expect(typeof saved.nextRun).toBe('number');

    const getRes = await get(app, '/api/pipelines/demo/schedule');
    const fetched = (await getRes.json()) as { schedule: { cron: string } | null };
    expect(fetched.schedule?.cron).toBe('@daily');
  });

  it('a disabled schedule has a null next-run', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const res = await post(app, '/api/pipelines/demo/schedule', {
      cron: '*/30 * * * *',
      enabled: false,
    });
    const body = (await res.json()) as { nextRun: number | null };
    expect(body.nextRun).toBeNull();
  });

  it('rejects an invalid cron with a 400 and does not persist it', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const res = await post(app, '/api/pipelines/demo/schedule', { cron: '99 * * * *' });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.any(String) });
    // Nothing was saved.
    const getRes = await get(app, '/api/pipelines/demo/schedule');
    expect(await getRes.json()).toEqual({ schedule: null, nextRun: null });
  });

  it('rejects a missing cron field with 400', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const res = await post(app, '/api/pipelines/demo/schedule', { enabled: true });
    expect(res.status).toBe(400);
  });

  it('404s when the pipeline does not exist', async () => {
    const app = appWith(freshStateDir());
    const res = await post(app, '/api/pipelines/ghost/schedule', { cron: '@daily' });
    expect(res.status).toBe(404);
  });

  it('400s an invalid pipeline id', async () => {
    const app = appWith(freshStateDir());
    const res = await get(app, '/api/pipelines/..%2Fetc/schedule');
    expect([400, 404]).toContain(res.status);
  });

  it('POST without a token is 401 (inherited bearer gate)', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/pipelines/demo/schedule`, {
          method: 'POST',
          headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
          body: JSON.stringify({ cron: '@daily' }),
        }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it('POST without same-origin proof is 403 (inherited CSRF gate)', async () => {
    const app = appWith(freshStateDir());
    await savePipeline(app, validPipeline());
    // No Origin header and no Sec-Fetch-Site: same-origin → CSRF rejection.
    const res = await post(app, '/api/pipelines/demo/schedule', { cron: '@daily' }, {});
    expect(res.status).toBe(403);
  });
});
