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
import { ReportStore } from './store.js';

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
  store: new ReportStore(path.join(trees, 'claude-rich'), '1.2.3'),
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
      store: new ReportStore(path.join(base, 'does-not-exist'), '1.2.3'),
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
