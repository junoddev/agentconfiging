/**
 * In-process security tests for the Hono app (agentconfig-gxo.2): requests
 * go straight into `app.fetch` — no socket — so every gate (Host allowlist,
 * Origin allowlist, constant-time bearer token, traversal-proof static,
 * content-free report JSON) is pinned at the application layer.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { ReportStore } from './store.js';

/** A registry whose default instance is `root` (the v1 single-store shape). */
function registryFor(root: string, version = '1.2.3'): InstanceRegistry {
  const registry = new InstanceRegistry(version);
  registry.seed(root, { makeDefault: true });
  return registry;
}

const trees = path.resolve(process.cwd(), 'fixtures/trees');
const PORT = 8787;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = 'test-session-token-test-session-token-test1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

// Static fixture: dist/ with an app shell + assets, a secret OUTSIDE dist,
// and a symlink inside dist that points at the secret.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-server-'));
const dist = path.join(base, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div>agentconfiging shell</div>');
fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app");');
fs.writeFileSync(path.join(dist, 'assets', 'style.css'), 'body{}');
fs.writeFileSync(path.join(base, 'secret.txt'), 'TOP-SECRET-OUTSIDE');
fs.symlinkSync(path.join(base, 'secret.txt'), path.join(dist, 'leak.txt'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const app = createApp({
  tokenHash,
  port: () => PORT,
  distDir: dist,
  registry: registryFor(path.join(trees, 'claude-rich')),
  version: '1.2.3',
});

function get(pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...headers } })),
  );
}

/** Keys that would mean file content leaked into the report (see cli/report.test.ts). */
const BANNED_KEYS = new Set(['patch', 'content', 'edits']);
function bannedKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) bannedKeys(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (BANNED_KEYS.has(key)) found.push(key);
      bannedKeys(child, found);
    }
  }
  return found;
}

describe('token gate on /api', () => {
  it('missing token → 401', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('wrong token of the SAME length → 401 (constant-time hash path)', async () => {
    const wrong = `${TOKEN.slice(0, -1)}X`;
    expect(wrong).toHaveLength(TOKEN.length);
    const res = await get('/api/health', { authorization: `Bearer ${wrong}` });
    expect(res.status).toBe(401);
  });

  it('short, empty-ish, and non-bearer credentials → 401', async () => {
    expect((await get('/api/health', { authorization: 'Bearer x' })).status).toBe(401);
    expect((await get('/api/health', { authorization: 'Bearer ' })).status).toBe(401);
    expect((await get('/api/health', { authorization: 'Basic dXNlcjpwdw==' })).status).toBe(401);
  });

  it('valid Authorization: Bearer → 200', async () => {
    const res = await get('/api/health', AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '1.2.3' });
  });

  it('?token= query is NOT a valid channel (leak-prone) → 401 even if correct', async () => {
    expect((await get(`/api/health?token=${TOKEN}`)).status).toBe(401);
    expect((await get('/api/health?token=')).status).toBe(401);
  });

  it('never emits CORS headers; nosniff everywhere; API is no-store', async () => {
    for (const res of [await get('/api/health', AUTH), await get('/'), await get('/api/nope')]) {
      expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    expect((await get('/api/health', AUTH)).headers.get('cache-control')).toBe('no-store');
  });

  it('framing/referrer/CSP protections on every response (API and static)', async () => {
    for (const res of [await get('/api/health', AUTH), await get('/')]) {
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
  });
});

describe('CSRF gate on state-changing methods (/api)', () => {
  // v1 has no write routes, so these probes hit the middleware then 404 —
  // but the middleware must reject the WRITE before the token/route stage.
  function api(method: string, headers: Record<string, string>): Promise<Response> {
    return Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/health`, { method, headers: { host: HOST, ...headers } }),
      ),
    );
  }

  it('write with NO Origin and no Sec-Fetch-Site → 403 (classic CSRF shape)', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await api(method, AUTH)).status).toBe(403);
    }
  });

  it('write with cross-site Origin → 403', async () => {
    expect((await api('POST', { ...AUTH, origin: 'http://evil.com' })).status).toBe(403);
  });

  it('write with same-origin Origin passes the CSRF gate (then 404: no route)', async () => {
    const res = await api('POST', { ...AUTH, origin: `http://127.0.0.1:${PORT}` });
    expect(res.status).toBe(404);
  });

  it('write with Sec-Fetch-Site: same-origin passes the CSRF gate (then 404)', async () => {
    const res = await api('POST', { ...AUTH, 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(404);
  });

  it('write with a bad token is still 401 once past the CSRF gate', async () => {
    const res = await api('POST', {
      authorization: 'Bearer wrong',
      origin: `http://127.0.0.1:${PORT}`,
    });
    expect(res.status).toBe(401);
  });
});

describe('Host allowlist (every request)', () => {
  const spoofed = ['evil.com:8787', '127.0.0.1.evil.com:8787', `[::1]:${PORT}`, '127.0.0.1:9999'];

  it.each(spoofed)('Host %s → 403 even with a valid token', async (host) => {
    const res = await app.fetch(
      new Request(`http://${HOST}/api/health`, { headers: { host, ...AUTH } }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('missing Host → 403; static paths are covered too', async () => {
    const noHost = await app.fetch(new Request(`http://${HOST}/api/health`, { headers: AUTH }));
    expect(noHost.status).toBe(403);
    const shell = await app.fetch(
      new Request(`http://${HOST}/`, { headers: { host: 'evil.com:8787' } }),
    );
    expect(shell.status).toBe(403);
  });

  it('127.0.0.1:<port> and localhost:<port> (case-insensitive) are allowed', async () => {
    expect((await get('/api/health', AUTH)).status).toBe(200);
    for (const host of [`localhost:${PORT}`, `LOCALHOST:${PORT}`]) {
      const res = await app.fetch(
        new Request(`http://${HOST}/api/health`, { headers: { host, ...AUTH } }),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('Origin allowlist (/api only)', () => {
  it.each(['http://evil.com', 'null', `http://127.0.0.1:9999`, `https://127.0.0.1:${PORT}`])(
    'Origin %s → 403 on /api even with a valid token',
    async (origin) => {
      const res = await get('/api/health', { ...AUTH, origin });
      expect(res.status).toBe(403);
    },
  );

  it("the server's own origins pass", async () => {
    for (const origin of [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]) {
      expect((await get('/api/health', { ...AUTH, origin })).status).toBe(200);
    }
  });

  it('static shell ignores Origin (public shell; no CORS headers to read it with)', async () => {
    const res = await get('/', { origin: 'http://evil.com' });
    expect(res.status).toBe(200);
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
  });
});

describe('GET /api/report', () => {
  it('runs the engine over root and returns content-free JSON', async () => {
    const res = await get('/api/report?scope=project', AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json['scope']).toBe('project');
    expect(json['localOnly']).toBe(false);
    expect(json['version']).toBe('1.2.3');
    expect(String(json['root'])).toContain('claude-rich');
    const findings = json['findings'] as { id: string; hasFix?: boolean; fixKind?: string }[];
    const withFix = findings.find((f) => f.id === 'settings-local-committed');
    expect(withFix).toMatchObject({ hasFix: true, fixKind: 'create-file' });
    expect(bannedKeys(json)).toEqual([]); // no patch/content/edits anywhere
  });

  it('defaults to scope=project; other scopes → 400', async () => {
    expect((await get('/api/report', AUTH)).status).toBe(200);
    expect((await get('/api/report?scope=global', AUTH)).status).toBe(400);
    expect((await get('/api/report?scope=..', AUTH)).status).toBe(400);
  });

  it('caches per scope; ?fresh=1 and invalidate() recompute', () => {
    const store = new ReportStore(path.join(trees, 'negative-plain'), '1.2.3');
    const first = store.get('project');
    expect(store.get('project')).toBe(first);
    expect(store.get('project', { fresh: true })).not.toBe(first);
    const second = store.get('project');
    store.invalidate();
    expect(store.get('project')).not.toBe(second);
  });

  it('engine failure → 500 constant body, details on stderr only', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry: registryFor(path.join(base, 'does-not-exist')),
      version: '1.2.3',
    });
    const res = await broken.fetch(
      new Request(`http://${HOST}/api/report`, { headers: { host: HOST, ...AUTH } }),
    );
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: 'report failed' });
    expect(body).not.toMatch(/\n\s+at /); // no stack traces in responses
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('unknown /api paths → 404 JSON (no static fallback), any method', async () => {
    const res = await get('/api/nope', AUTH);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
    // Same-origin write (past the CSRF gate) still 404s: read-only v1 has no
    // POST routes. (The CSRF rejection of origin-less writes is covered above.)
    const post = await app.fetch(
      new Request(`http://${HOST}/api/health`, {
        method: 'POST',
        headers: { host: HOST, ...AUTH, origin: `http://127.0.0.1:${PORT}` },
      }),
    );
    expect(post.status).toBe(404); // read-only v1: no POST routes exist
  });
});

describe('instance endpoints (agentconfig-gxo.6)', () => {
  const SAME_ORIGIN = `http://127.0.0.1:${PORT}`;

  /** App with a registry whose stores are counted, so lazy/unload are observable. */
  function makeInstanceApp(defaultRoot: string) {
    const builds: string[] = [];
    const scans: string[] = [];
    const registry = new InstanceRegistry('1.2.3', (root) => {
      builds.push(root);
      return {
        get: () => {
          scans.push(root);
          return { root, scope: 'project', findings: [] } as unknown;
        },
        invalidate: () => undefined,
      } as unknown as ReportStore;
    });
    registry.seed(defaultRoot, { makeDefault: true });
    const instApp = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry,
      version: '1.2.3',
    });
    const send = (
      pathname: string,
      method: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ) =>
      Promise.resolve(
        instApp.fetch(
          new Request(`http://${HOST}${pathname}`, {
            method,
            headers: {
              host: HOST,
              ...AUTH,
              ...(method === 'GET'
                ? {}
                : { origin: SAME_ORIGIN, 'content-type': 'application/json' }),
              ...extra,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        ),
      );
    return { registry, builds, scans, send };
  }

  it('GET /api/instances lists the default instance (id opaque, path present)', async () => {
    const { send } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const res = await send('/api/instances', 'GET');
    expect(res.status).toBe(200);
    const { instances } = (await res.json()) as { instances: Record<string, unknown>[] };
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ isDefault: true, loaded: false });
    expect(String(instances[0]!['id'])).toMatch(/^[0-9a-f]{16}$/);
    expect(String(instances[0]!['root'])).toContain('claude-rich');
  });

  it('POST /api/instances adds a validated dir; file → 400, missing → 400, blank → 400', async () => {
    const { send, registry } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const ok = await send('/api/instances', 'POST', { path: path.join(trees, 'negative-plain') });
    expect(ok.status).toBe(200);
    expect((await ok.json())['loaded']).toBe(false); // added LAZY
    expect(registry.size).toBe(2);

    const asFile = await send('/api/instances', 'POST', { path: path.join(base, 'secret.txt') });
    expect(asFile.status).toBe(400);
    const missing = await send('/api/instances', 'POST', { path: path.join(base, 'nope') });
    expect(missing.status).toBe(400);
    expect((await send('/api/instances', 'POST', {})).status).toBe(400);
    expect((await send('/api/instances', 'POST', 'not json')).status).toBe(400);
    expect(registry.size).toBe(2); // no bad root ever entered
  });

  it('added instance is LAZY: no store/scan until GET /api/report?instance= hits it', async () => {
    const { send, builds, scans } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const added = (await (
      await send('/api/instances', 'POST', { path: path.join(trees, 'negative-plain') })
    ).json()) as {
      id: string;
    };
    expect(builds).toEqual([]); // added, never scanned
    expect(scans).toEqual([]);

    const rep = await send(`/api/report?instance=${added.id}`, 'GET');
    expect(rep.status).toBe(200);
    expect(builds).toHaveLength(1); // scanned on first open
    expect(scans).toHaveLength(1);
  });

  it('POST /api/instances/:id/unload frees the store; re-report re-scans', async () => {
    const { send, builds } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const added = (await (
      await send('/api/instances', 'POST', { path: path.join(trees, 'negative-plain') })
    ).json()) as {
      id: string;
    };
    await send(`/api/report?instance=${added.id}`, 'GET');
    expect(builds).toHaveLength(1);

    const unloaded = await send(`/api/instances/${added.id}/unload`, 'POST');
    expect(unloaded.status).toBe(200);
    expect((await unloaded.json())['loaded']).toBe(false);

    await send(`/api/report?instance=${added.id}`, 'GET');
    expect(builds).toHaveLength(2); // rebuilt → re-scanned
  });

  it('POST /api/instances/scan returns discovery hits WITHOUT adding them', async () => {
    const { send, registry } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const before = registry.size;
    const res = await send('/api/instances/scan', 'POST', { path: trees });
    expect(res.status).toBe(200);
    const { hits } = (await res.json()) as { hits: { root: string }[] };
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0); // fixtures/trees carries agent markers
    expect(registry.size).toBe(before); // scan OFFERS, never auto-adds
  });

  it('POST /api/instances/scan on a bad root → 400 (never a partial scan)', async () => {
    const { send } = makeInstanceApp(path.join(trees, 'claude-rich'));
    expect(
      (await send('/api/instances/scan', 'POST', { path: path.join(base, 'nope') })).status,
    ).toBe(400);
    expect(
      (await send('/api/instances/scan', 'POST', { path: path.join(base, 'secret.txt') })).status,
    ).toBe(400);
    expect((await send('/api/instances/scan', 'POST', {})).status).toBe(400);
  });

  it('DELETE /api/instances/:id removes it; unknown id → 404', async () => {
    const { send, registry } = makeInstanceApp(path.join(trees, 'claude-rich'));
    const added = (await (
      await send('/api/instances', 'POST', { path: path.join(trees, 'negative-plain') })
    ).json()) as {
      id: string;
    };
    expect((await send(`/api/instances/${added.id}`, 'DELETE')).status).toBe(200);
    expect(registry.size).toBe(1);
    expect((await send(`/api/instances/${added.id}`, 'DELETE')).status).toBe(404);
    expect((await send('/api/instances/deadbeefdeadbeef/unload', 'POST')).status).toBe(404);
  });

  it('GET /api/report?instance= validates the selector: unknown id → 404, unregistered path → 404, never a scan', async () => {
    const { send, builds } = makeInstanceApp(path.join(trees, 'claude-rich'));
    expect((await send('/api/report?instance=deadbeefdeadbeef', 'GET')).status).toBe(404);
    // An attacker-supplied absolute path that is NOT registered is never scanned.
    const probe = encodeURIComponent(path.join(trees, 'negative-plain'));
    expect((await send(`/api/report?instance=${probe}`, 'GET')).status).toBe(404);
    expect((await send('/api/report?instance=%2Fetc', 'GET')).status).toBe(404);
    expect(builds).toEqual([]); // no unregistered path ever caused a store build
  });

  it('new write-shaped routes inherit the token + CSRF gates', async () => {
    const { send } = makeInstanceApp(path.join(trees, 'claude-rich'));
    // No Origin + no Sec-Fetch-Site → CSRF 403 before anything else.
    const noOrigin = await Promise.resolve(
      createApp({
        tokenHash,
        port: () => PORT,
        distDir: dist,
        registry: registryFor(path.join(trees, 'claude-rich')),
        version: '1.2.3',
      }).fetch(
        new Request(`http://${HOST}/api/instances`, {
          method: 'POST',
          headers: { host: HOST, ...AUTH },
          body: JSON.stringify({ path: trees }),
        }),
      ),
    );
    expect(noOrigin.status).toBe(403);
    // Bad token (with same-origin) → 401.
    const badToken = await send(
      '/api/instances',
      'POST',
      { path: trees },
      { authorization: 'Bearer wrong' },
    );
    expect(badToken.status).toBe(401);
    // GET list without a token → 401.
    const noToken = await Promise.resolve(
      createApp({
        tokenHash,
        port: () => PORT,
        distDir: dist,
        registry: registryFor(path.join(trees, 'claude-rich')),
        version: '1.2.3',
      }).fetch(new Request(`http://${HOST}/api/instances`, { headers: { host: HOST } })),
    );
    expect(noToken.status).toBe(401);
  });
});

describe('real engine scan path (agentconfig-gxo.6 review)', () => {
  function realGet(instApp: ReturnType<typeof createApp>, pathname: string): Promise<Response> {
    return Promise.resolve(
      instApp.fetch(new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH } })),
    );
  }

  it('the REAL store factory scans a bounded tree end-to-end → 200 with findings', async () => {
    const realRoot = fs.mkdtempSync(path.join(base, 'realscan-'));
    fs.mkdirSync(path.join(realRoot, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(realRoot, 'CLAUDE.md'), '# project guide\n');
    fs.writeFileSync(path.join(realRoot, '.claude', 'agents', 'a.md'), 'agent\n');

    // No fake factory: this exercises scanProject → detect → buildReport.
    const registry = new InstanceRegistry('1.2.3');
    registry.seed(realRoot, { makeDefault: true });
    const realApp = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry,
      version: '1.2.3',
    });

    const res = await realGet(realApp, '/api/report');
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(String(json['root'])).toContain('realscan-');
    expect((json['agents'] as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(json['findings'])).toBe(true);
  });

  it('a system-root-style over-cap scan yields a fast typed error (500), not a hang', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bigRoot = fs.mkdtempSync(path.join(base, 'overcap-'));
    // Many sibling config dirs; the injected tiny maxDirs trips the walk fast.
    for (let i = 0; i < 12; i += 1) {
      fs.mkdirSync(path.join(bigRoot, '.claude', `d${i}`), { recursive: true });
      fs.writeFileSync(path.join(bigRoot, '.claude', `d${i}`, 'r.md'), 'x\n');
    }
    // Real ReportStore, but with a maxDirs override standing in for the
    // whole-disk case — proves add + report becomes E_TOO_MANY_DIRS (→ 500),
    // surfaced cleanly, instead of a synchronous disk storm.
    const registry = new InstanceRegistry(
      '1.2.3',
      (root, v) => new ReportStore(root, v, { maxDirs: 2 }),
    );
    registry.seed(bigRoot, { makeDefault: true });
    const cappedApp = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry,
      version: '1.2.3',
    });

    const started = Date.now();
    const res = await realGet(cappedApp, '/api/report');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'report failed' });
    expect(Date.now() - started).toBeLessThan(2000); // fast fail, not a hang
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe('static app shell', () => {
  it('serves index.html at / with the right Content-Type, token-free', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toContain('agentconfiging shell');
  });

  it('serves assets with correct Content-Types', async () => {
    const js = await get('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const css = await get('/assets/style.css');
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  it('extensionless routes fall back to index.html; asset misses are 404', async () => {
    const route = await get('/settings');
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('agentconfiging shell');
    expect((await get('/missing.js')).status).toBe(404);
  });

  it('no directory listing: directory paths serve the shell, never entries', async () => {
    for (const p of ['/assets', '/assets/']) {
      const res = await get(p);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('agentconfiging shell');
      expect(body).not.toContain('app.js');
    }
  });

  it.each([
    '/%2e%2e%2fsecret.txt',
    '/..%2f..%2fsecret.txt',
    '/..%5c..%5csecret.txt',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/%2e%2e/secret.txt', // URL-normalized to /secret.txt → asset miss
    '/etc/passwd.txt',
    '/secret.txt',
  ])('traversal probe %s → 400/404, never outside content', async (probe) => {
    const res = await get(probe);
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain('TOP-SECRET-OUTSIDE');
    expect(body).not.toContain('root:');
  });

  it('/etc/passwd (extensionless, no ..) hits the SPA fallback — shell only, never the file', async () => {
    const res = await get('/etc/passwd');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('agentconfiging shell');
    expect(body).not.toContain('root:');
  });

  it('symlink pointing outside dist is not followed', async () => {
    const res = await get('/leak.txt');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('TOP-SECRET-OUTSIDE');
  });

  it('malformed percent-encoding → 400', async () => {
    expect((await get('/%zz')).status).toBe(400);
  });
});
