/**
 * In-process tests for GET /api/context-health (bead agentconfig-7yb.6).
 * Requests go straight into `app.fetch`, pinning the content-free size view over
 * a real scanned project, the inherited token gate, and the unknown-instance
 * 404. The response carries sizes + paths + suggestions — never a file body.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContextCost, ContextHealth } from '../core/index.js';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';

const PORT = 8794;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'ctxhealth-session-token-ctxhealth-session-tok1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-ctxhealth-'));
const projectRoot = path.join(base, 'project');
const otherRoot = path.join(base, 'other');

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function writeFileDeep(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function build(): void {
  fs.rmSync(base, { recursive: true, force: true });
  writeFileDeep(path.join(projectRoot, 'CLAUDE.md'), 'x'.repeat(60 * 1024)); // bloated guide
  writeFileDeep(path.join(projectRoot, '.claude', 'settings.json'), '{}');
  writeFileDeep(path.join(projectRoot, '.claude', 'rules', 'style.md'), '# style');
  writeFileDeep(path.join(projectRoot, '.claude', 'logs', 'run.log'), 'noise'); // not context
  writeFileDeep(path.join(otherRoot, 'AGENTS.md'), 'codex launch context');
}

function app() {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  registry.seed(otherRoot);
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
  });
}

function get(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app().fetch(
      new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH, ...headers } }),
    ),
  );
}

beforeEach(build);

describe('GET /api/context-health', () => {
  it('returns the content-free size view over the scanned project', async () => {
    const res = await get('/api/context-health');
    expect(res.status).toBe(200);
    const health = (await res.json()) as ContextHealth;

    const instructions = health.byCategory.find((c) => c.category === 'instructions');
    expect(instructions?.bytes).toBe(60 * 1024);
    expect(health.status).toBe('over');
    // largest carries paths + sizes only — no file content anywhere in the body.
    expect(health.largest[0]?.path).toBe('CLAUDE.md');
    expect(JSON.stringify(health)).not.toContain('xxxxx');
    // runtime-state logs never count as context config.
    expect(health.largest.some((f) => f.path.includes('logs/'))).toBe(false);
  });

  it('surfaces the budget verdict + bloated-guide suggestion', async () => {
    const health = (await (await get('/api/context-health')).json()) as ContextHealth;
    const ids = health.suggestions.map((s) => s.id);
    expect(ids).toContain('over-budget');
    expect(ids.some((id) => id.startsWith('guide-large-'))).toBe(true);
  });

  it('requires the bearer token (inherited gate)', async () => {
    const res = await Promise.resolve(
      app().fetch(new Request(`http://${HOST}/api/context-health`, { headers: { host: HOST } })),
    );
    expect(res.status).toBe(401);
  });

  it('404s an unknown instance', async () => {
    const res = await get('/api/context-health?instance=nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/context-cost', () => {
  it('returns the per-agent token view over detected files without file bodies', async () => {
    const res = await get('/api/context-cost');
    expect(res.status).toBe(200);
    const cost = (await res.json()) as ContextCost;

    expect(cost.budgetTokens).toBe(100000);
    expect(cost.agents.map((a) => a.kind)).toEqual(['claude-code']);
    expect(cost.agents[0]?.totalTokens).toBeGreaterThan(0);
    expect(cost.agents[0]?.budgetRatio).toBe(cost.agents[0]!.totalTokens / 100000);
    expect(cost.agents[0]?.files?.map((f) => f.path)).toContain('CLAUDE.md');
    expect(cost.agents[0]?.files?.some((f) => f.path.includes('logs/'))).toBe(false);
    expect(JSON.stringify(cost)).not.toContain('xxxxx');
  });

  it('honors the instance query selector', async () => {
    const otherId = InstanceRegistry.idFor(fs.realpathSync(otherRoot));
    const res = await get(`/api/context-cost?instance=${otherId}`);
    expect(res.status).toBe(200);
    const cost = (await res.json()) as ContextCost;
    expect(cost.agents.map((a) => a.kind)).toEqual(['codex']);
    expect(cost.agents[0]?.files).toEqual([
      { path: 'AGENTS.md', tokens: 5, category: 'instructions' },
    ]);
  });

  it('requires the bearer token and 404s an unknown instance', async () => {
    const missingToken = await Promise.resolve(
      app().fetch(new Request(`http://${HOST}/api/context-cost`, { headers: { host: HOST } })),
    );
    expect(missingToken.status).toBe(401);

    const unknown = await get('/api/context-cost?instance=nope');
    expect(unknown.status).toBe(404);
  });

  it('maps context-cost engine failures to a constant 500 body', async () => {
    const registry = new InstanceRegistry('1.0.0');
    registry.seed(path.join(base, 'missing-root'), { makeDefault: true });
    const failingApp = createApp({
      tokenHash,
      port: () => PORT,
      distDir: path.join(base, 'nodist'),
      registry,
      version: '1.0.0',
    });

    const res = await Promise.resolve(
      failingApp.fetch(
        new Request(`http://${HOST}/api/context-cost`, { headers: { host: HOST, ...AUTH } }),
      ),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'context-cost failed' });
  });
});
