/**
 * ============================================================================
 * CONSOLIDATED SECURITY / THREAT-MODEL SUITE (bead agentconfig-gxo.5)
 * ============================================================================
 *
 * This file is the single, threat-organized gate for the ENTIRE browser-facing
 * server surface (SPEC §4.2/§4.3): the Hono app (report + write + delete + file
 * + instances/scan/unload + static shell), the node:http ↔ fetch bridge, and
 * the WebSocket upgrade. It is meant to be read top-to-bottom as living
 * documentation of the model, and each block attacks the REAL built app/server
 * (via `createApp` + `app.fetch`, or `startServer` + raw sockets) end-to-end.
 *
 * It CONSOLIDATES and CROSS-CHECKS security assertions that also live, close to
 * the code, in app.test.ts / write.test.ts / registry.test.ts / ws.test.ts /
 * ws.integration.test.ts (those stay — they are the unit layer). Where a gap
 * existed, the test here is net-new.
 *
 * THREAT MODEL  →  THE DEFENSE  →  THE TESTS THAT PROVE IT
 * ---------------------------------------------------------------------------
 * T1 DNS REBINDING — a rebound hostname still arrives with the attacker's Host.
 *    Defense: Host allowlist (exact 127.0.0.1:<port> / localhost:<port>) on
 *    EVERY request (app.ts) + duplicate-Host / absolute-form rejection in the
 *    bridge (bridge.ts) + URL always built from the server's own origin
 *    (X-Forwarded-Host ignored).            → describe('T1 …')
 * T2 CSRF — a cross-site page forging state-changing requests.
 *    Defense: Origin allowlist on all /api, MANDATORY same-origin proof on
 *    non-safe methods, NO CORS headers, anti-framing headers.  → describe('T2 …')
 * T3 MISSING AUTH — any /api call without the session token.
 *    Defense: constant-time bearer token on every /api route + WS upgrade; no
 *    ?token= channel; token never echoed/logged.               → describe('T3 …')
 * T4 PATH TRAVERSAL / SYMLINK ESCAPE — reading or writing outside scope.
 *    Defense: input discipline + realpath scope check + dangling-symlink tail
 *    walk + O_NOFOLLOW (pathguard.ts / write.ts); traversal-proof static
 *    server (app.ts).                                            → describe('T4 …')
 * T5 ARBITRARY-PATH SCAN / DISK STORM — ?instance= as a filesystem primitive.
 *    Defense: selector resolves only against REGISTERED instances; scans are
 *    dir-bounded (E_TOO_MANY_DIRS fast-fail).                    → describe('T5 …')
 * T6 WS ABUSE — CORS/SOP do not apply to a WebSocket handshake.
 *    Defense: same Host/Origin/token gates pre-101; fail-close on hostile
 *    frames; content-free pushes; connection cap.                → describe('T6 …')
 * T7 NETWORK EXPOSURE — binding a routable interface.
 *    Defense: startServer binds 127.0.0.1 only, random port; non-loopback host
 *    refused.                                                    → describe('T7 …')
 * T8 CONTENT DISCLOSURE — leaking file bodies / fix patches over the wire.
 *    Defense: report + WS are content-free; fix.edits[].patch is never
 *    serialized (only hasFix/fixKind).                           → describe('T8 …')
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { GlobalStore, ReportStore } from './store.js';
import { WsHub, handleUpgrade } from './ws.js';
import { startServer, type RunningServer } from './index.js';
import type { WriteScope } from './pathguard.js';
import { RawWs, craftFrame, closeCode, rawHttp } from './security.testutil.js';

// ---------------------------------------------------------------------------
// Shared constants + fixtures for the in-process (app.fetch) blocks.
// ---------------------------------------------------------------------------

const trees = path.resolve(process.cwd(), 'fixtures/trees');
const PORT = 8790;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'security-suite-token-security-suite-token-x1';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

/** A canary secret planted on disk; it must never surface in a response. */
const SECRET = 'CANARY-SECRET-do-not-leak-4f2a9c';

// Static-shell fixture: a dist/ with a shell + assets, a secret OUTSIDE dist,
// a symlink inside dist pointing at that secret, and a DANGLING symlink.
const staticBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sec-static-'));
const dist = path.join(staticBase, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div>agentconfiging shell</div>');
fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app");');
fs.writeFileSync(path.join(staticBase, 'secret.txt'), `OUTSIDE-${SECRET}`);
fs.symlinkSync(path.join(staticBase, 'secret.txt'), path.join(dist, 'leak.txt'));
fs.symlinkSync(path.join(staticBase, 'nowhere.txt'), path.join(dist, 'dangling.txt'));
// A symlinked DIRECTORY inside dist that escapes to the fixture root.
fs.symlinkSync(staticBase, path.join(dist, 'escaped'));

afterAll(() => fs.rmSync(staticBase, { recursive: true, force: true }));

function registryFor(root: string): InstanceRegistry {
  const registry = new InstanceRegistry('9.9.9');
  registry.seed(root, { makeDefault: true });
  return registry;
}

/** The default app used by most in-process HTTP blocks (report over claude-rich). */
function defaultApp() {
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: dist,
    registry: registryFor(path.join(trees, 'claude-rich')),
    version: '9.9.9',
  });
}

/** GET against `app` with a spoofable Host (defaults to the allowed one). */
function get(
  app: ReturnType<typeof createApp>,
  pathname: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.fetch(new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...headers } })),
  );
}

/** Arbitrary-method request against `app`. */
function req(
  app: ReturnType<typeof createApp>,
  pathname: string,
  method: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method,
        headers: { host: HOST, ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  );
}

/** Recursively collect content-bearing or provider credential keys that must never appear. */
const BANNED_KEYS = new Set([
  'patch',
  'content',
  'edits',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'token',
]);
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

// ===========================================================================
// T1 — DNS REBINDING (Host allowlist, every request)
// ===========================================================================
describe('T1 DNS rebinding: Host allowlist on every request', () => {
  const app = defaultApp();

  // Every one of these arrives (post-rebind or via a proxy) with a Host the
  // allowlist does not contain, so all must be refused BEFORE routing — even
  // carrying a valid token. Covers: foreign host, look-alike subdomain,
  // 127.0.0.1 as a subdomain label, wrong port, IPv6 loopback, no port,
  // trailing dot, userinfo@host, and three obfuscated encodings of 127.0.0.1.
  const rejected: Array<[string, string]> = [
    ['foreign host', `evil.com:${PORT}`],
    ['look-alike suffix', `127.0.0.1.evil.com:${PORT}`],
    ['loopback as subdomain label', `sub.127.0.0.1:${PORT}`],
    ['wrong port', '127.0.0.1:9999'],
    ['IPv6 loopback', `[::1]:${PORT}`],
    ['no port', '127.0.0.1'],
    ['trailing dot', `127.0.0.1.:${PORT}`],
    ['userinfo prefix', `user@127.0.0.1:${PORT}`],
    ['octal-obfuscated IP', `0177.0.0.1:${PORT}`],
    ['decimal-obfuscated IP', `2130706433:${PORT}`],
    ['short-form IP', `127.1:${PORT}`],
  ];

  it.each(rejected)('Host "%s" (%s) → 403 even with a valid token', async (_label, host) => {
    const res = await get(app, '/api/health', { ...AUTH, host });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('missing Host → 403 (api and static both covered)', async () => {
    const api = await Promise.resolve(
      app.fetch(new Request(`http://${HOST}/api/health`, { headers: AUTH })),
    );
    expect(api.status).toBe(403);
    const shell = await Promise.resolve(app.fetch(new Request(`http://${HOST}/`)));
    expect(shell.status).toBe(403);
  });

  it('the two loopback hosts (case-insensitive) are the ONLY accepted ones', async () => {
    for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `LOCALHOST:${PORT}`]) {
      expect((await get(app, '/api/health', { ...AUTH, host })).status).toBe(200);
    }
  });

  it('X-Forwarded-Host cannot override the real Host (bridge builds URLs from own origin)', async () => {
    // A valid Host with a hostile X-Forwarded-Host still succeeds and is routed
    // normally — the forwarded header is never consulted for the allowlist or
    // for URL construction.
    const res = await get(app, '/api/health', { ...AUTH, 'x-forwarded-host': 'evil.com' });
    expect(res.status).toBe(200);
    // And a hostile Host is NOT rescued by a friendly X-Forwarded-Host.
    const spoofed = await get(app, '/api/health', {
      ...AUTH,
      host: 'evil.com',
      'x-forwarded-host': HOST,
    });
    expect(spoofed.status).toBe(403);
  });
});

// ===========================================================================
// T2 — CSRF (Origin allowlist + same-origin proof on writes)
// ===========================================================================
describe('T2 CSRF: Origin allowlist, same-origin writes, no CORS, anti-framing', () => {
  const app = defaultApp();

  it.each(['http://evil.com', 'null', `http://127.0.0.1:9999`, `https://127.0.0.1:${PORT}`])(
    'cross-site / null Origin "%s" on /api → 403 even with a valid token',
    async (origin) => {
      expect((await get(app, '/api/health', { ...AUTH, origin })).status).toBe(403);
    },
  );

  it("the server's own origins pass the Origin gate", async () => {
    for (const origin of [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]) {
      expect((await get(app, '/api/health', { ...AUTH, origin })).status).toBe(200);
    }
  });

  it('non-safe methods with NO Origin and no Sec-Fetch-Site → 403 (classic CSRF shape)', async () => {
    // The write/instances routes are non-safe; a form/img CSRF sends no Origin.
    for (const [pathname, method, body] of [
      ['/api/instances', 'POST', { path: trees }],
      ['/api/instances/x/unload', 'POST', {}],
      ['/api/instances/x', 'DELETE', undefined],
      ['/api/write', 'POST', { path: 'CLAUDE.md', content: 'x' }],
      ['/api/delete', 'POST', { path: 'CLAUDE.md' }],
    ] as const) {
      const res = await req(app, pathname, method, { ...AUTH }, body);
      expect(res.status).toBe(403);
    }
  });

  it('Sec-Fetch-Site: same-origin satisfies the write proof even without Origin', async () => {
    // Passes the CSRF gate, then 404 (no such instance) — proving the gate, not
    // the route, was the thing being tested.
    const res = await req(app, '/api/instances/x/unload', 'POST', {
      ...AUTH,
      'sec-fetch-site': 'same-origin',
    });
    expect(res.status).toBe(404);
  });

  it('NO CORS headers on any response (api ok, api error, static)', async () => {
    const responses = [
      await get(app, '/api/health', AUTH),
      await get(app, '/api/health', { ...AUTH, origin: 'http://evil.com' }),
      await get(app, '/'),
    ];
    for (const res of responses) {
      expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
    }
  });

  it('anti-framing + hardening headers on every response (api and static)', async () => {
    for (const res of [await get(app, '/api/health', AUTH), await get(app, '/')]) {
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
});

// ===========================================================================
// T3 — TOKEN GATE (bearer, constant-time, no ?token=, never echoed)
// ===========================================================================
describe('T3 token gate: bearer required on every /api route', () => {
  const app = defaultApp();

  // Every /api entry point (each method it exposes). No-token → 401 across all.
  const routes: Array<[string, string, unknown]> = [
    ['/api/health', 'GET', undefined],
    ['/api/report', 'GET', undefined],
    ['/api/instances', 'GET', undefined],
    ['/api/instances', 'POST', { path: trees }],
    ['/api/instances/scan', 'POST', { path: trees }],
    ['/api/instances/x/unload', 'POST', {}],
    ['/api/instances/x', 'DELETE', undefined],
    ['/api/file?path=CLAUDE.md', 'GET', undefined],
    ['/api/write', 'POST', { path: 'CLAUDE.md', content: 'x' }],
    ['/api/delete', 'POST', { path: 'CLAUDE.md' }],
  ];

  it.each(routes)('no token: %s %s → 401', async (pathname, method) => {
    // Include a same-origin header so non-safe routes reach the token check
    // (not the CSRF check) — proving the token gate itself fires.
    const res = await req(app, pathname, method, {
      origin: ORIGIN,
      'content-type': 'application/json',
    });
    expect(res.status).toBe(401);
  });

  it('wrong (same length), short, empty, prefix, and non-bearer creds → 401', async () => {
    // Comparison is SHA-256 + timingSafeEqual (see app.ts), so all of these take
    // the same-shape path; we assert the outcome, not wall-clock timing.
    const sameLenWrong = `${TOKEN.slice(0, -1)}X`;
    expect(sameLenWrong).toHaveLength(TOKEN.length);
    const prefix = TOKEN.slice(0, TOKEN.length - 5);
    for (const cred of [
      `Bearer ${sameLenWrong}`,
      'Bearer x',
      'Bearer ',
      `Bearer ${prefix}`,
      'Basic dXNlcjpwdw==',
    ]) {
      expect((await get(app, '/api/health', { authorization: cred })).status).toBe(401);
    }
  });

  it('?token= query is NOT a channel — 401 even when the value is correct', async () => {
    expect((await get(app, `/api/health?token=${TOKEN}`)).status).toBe(401);
    expect((await get(app, '/api/report?token=')).status).toBe(401);
  });

  it('a valid bearer token is accepted', async () => {
    expect((await get(app, '/api/health', AUTH)).status).toBe(200);
  });

  it('the token never appears in any response body or header', async () => {
    for (const res of [await get(app, '/api/health', AUTH), await get(app, '/api/report', AUTH)]) {
      expect([...res.headers.values()].join('\n')).not.toContain(TOKEN);
      expect(await res.text()).not.toContain(TOKEN);
    }
  });
});

// ===========================================================================
// T4 — TRAVERSAL + SYMLINK ESCAPE (write / delete / read + static)
// ===========================================================================
describe('T4 traversal + symlink escape: write / delete / read API', () => {
  // A fresh layout per test — symlink tests mutate the tree.
  //   base/project/           (project scope)   CLAUDE.md, .claude/
  //   base/home/.claude/      (global scope)
  //   base/escape/target.md   (out-of-scope symlink dest, canary)
  //   base/outside.md         (out-of-scope existing file, canary)
  let base: string;
  let projectRoot: string;
  let globalRoot: string;
  let trashDir: string;
  let escapeDir: string;
  let scopes: WriteScope[];

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sec-write-'));
    projectRoot = path.join(base, 'project');
    globalRoot = path.join(base, 'home', '.claude');
    trashDir = path.join(base, 'trash');
    escapeDir = path.join(base, 'escape');
    fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
    fs.mkdirSync(globalRoot, { recursive: true });
    fs.mkdirSync(escapeDir, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), 'line one\nline two\n');
    fs.writeFileSync(path.join(base, 'outside.md'), `OUTSIDE-${SECRET}`);
    fs.writeFileSync(path.join(escapeDir, 'target.md'), `VIA-SYMLINK-${SECRET}`);
    scopes = [
      { root: fs.realpathSync(projectRoot), kind: 'project' },
      { root: fs.realpathSync(globalRoot), kind: 'global' },
    ];
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  function writeApp() {
    return createApp({
      tokenHash,
      port: () => PORT,
      distDir: path.join(base, 'nodist'),
      registry: registryFor(projectRoot),
      version: '9.9.9',
      scopes,
      trashDir,
    });
  }
  const wpost = (pathname: string, body: unknown) =>
    req(
      writeApp(),
      pathname,
      'POST',
      { ...AUTH, origin: ORIGIN, 'content-type': 'application/json' },
      body,
    );
  const wget = (pathname: string) => get(writeApp(), pathname, AUTH);

  // The full hostile-input matrix: dot chains, encoded/double-encoded traversal,
  // backslash, NUL, absolute, and Windows-alias segments. Every one → 400/403
  // and the out-of-scope canary is untouched.
  const hostilePaths = [
    '../../etc/passwd',
    '../outside.md',
    '.claude/../../outside.md',
    '%2e%2e/outside.md',
    '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '%252e%252e%252foutside.md', // double-encoded
    '..%5c..%5coutside.md',
    '.claude\\..\\..\\outside.md',
    'CLAUDE.md\0.png',
    '/etc/passwd',
    'foo/bar.', // trailing dot (Windows alias)
    'foo/ ', // trailing space
  ];

  it.each(hostilePaths)('write rejects hostile path %j → 400/403, canary intact', async (p) => {
    const res = await wpost('/api/write', { path: p, content: 'PWNED', dryRun: false });
    expect([400, 403]).toContain(res.status);
    expect(fs.readFileSync(path.join(base, 'outside.md'), 'utf-8')).toBe(`OUTSIDE-${SECRET}`);
  });

  it('absolute out-of-scope write → 403, canary intact', async () => {
    const res = await wpost('/api/write', {
      path: path.join(base, 'outside.md'),
      content: 'PWNED',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(base, 'outside.md'), 'utf-8')).toBe(`OUTSIDE-${SECRET}`);
  });

  it('symlink (file) in scope → out of scope: write refused, dest untouched', async () => {
    fs.symlinkSync(path.join(escapeDir, 'target.md'), path.join(projectRoot, '.claude', 'link.md'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await wpost('/api/write', {
      path: '.claude/link.md',
      content: 'PWNED',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.readFileSync(path.join(escapeDir, 'target.md'), 'utf-8')).toBe(
      `VIA-SYMLINK-${SECRET}`,
    );
  });

  it('symlinked DIRECTORY in scope → out of scope is not traversed → 403', async () => {
    fs.symlinkSync(escapeDir, path.join(projectRoot, '.claude', 'escaped'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await wpost('/api/write', {
      path: '.claude/escaped/new.md',
      content: 'x',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(escapeDir, 'new.md'))).toBe(false);
  });

  // Incident agentconfig-gxo.3 (with agentconfig-71h.11 follow-ups): the
  // CRITICAL dangling-symlink write-through escape.
  // realpathSync throws ENOENT on a dangling link, so a naive resolver would
  // treat the leaf as a to-be-created tail and FOLLOW it out of scope on write.
  it('agentconfig-gxo.3 dangling symlink/ENOENT write fails closed: 403, target NOT created', async () => {
    fs.mkdirSync(path.join(base, 'evil-outside'), { recursive: true });
    const target = path.join(base, 'evil-outside', 'PWNED.md');
    fs.symlinkSync(target, path.join(projectRoot, '.claude', 'pwn.md'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await wpost('/api/write', {
      path: '.claude/pwn.md',
      content: 'PWNED',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('.git/hooks/pre-commit RCE via dangling symlink → 403, hook NOT created', async () => {
    fs.mkdirSync(path.join(projectRoot, '.git', 'hooks'), { recursive: true });
    const hook = path.join(projectRoot, '.git', 'hooks', 'pre-commit');
    fs.symlinkSync(hook, path.join(projectRoot, '.claude', 'hook.md'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await wpost('/api/write', {
      path: '.claude/hook.md',
      content: '#!/bin/sh\ntouch /tmp/agentconfig-pwned\n',
      dryRun: false,
    });
    expect(res.status).toBe(403);
    expect(fs.existsSync(hook)).toBe(false);
  });

  it('delete of a symlinked (and dangling-symlinked) target → 403, canary intact', async () => {
    fs.symlinkSync(path.join(base, 'outside.md'), path.join(projectRoot, '.claude', 'del.md'));
    fs.symlinkSync(path.join(base, 'gone.md'), path.join(projectRoot, '.claude', 'delgone.md'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    expect((await wpost('/api/delete', { path: '.claude/del.md', dryRun: false })).status).toBe(
      403,
    );
    expect((await wpost('/api/delete', { path: '.claude/delgone.md', dryRun: false })).status).toBe(
      403,
    );
    expect(fs.readFileSync(path.join(base, 'outside.md'), 'utf-8')).toBe(`OUTSIDE-${SECRET}`);
  });

  it('read (GET /api/file) of a symlink escaping scope → 403, no content leaked', async () => {
    fs.symlinkSync(path.join(base, 'outside.md'), path.join(projectRoot, '.claude', 'read.md'));
    scopes = [{ root: fs.realpathSync(projectRoot), kind: 'project' }];
    const res = await wget('/api/file?path=.claude/read.md');
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('read traversal probes → 400/403, never out-of-scope content', async () => {
    for (const probe of [
      '..%2f..%2fetc%2fpasswd',
      encodeURIComponent(path.join(base, 'outside.md')),
    ]) {
      const res = await wget(`/api/file?path=${probe}`);
      expect([400, 403]).toContain(res.status);
      expect(await res.text()).not.toContain(SECRET);
    }
  });

  it('no existence oracle: out-of-scope existing vs missing → byte-identical 403', async () => {
    const existing = await wpost('/api/write', {
      path: path.join(base, 'outside.md'),
      content: 'x',
      dryRun: true,
    });
    const missing = await wpost('/api/write', {
      path: path.join(base, 'nope-does-not-exist.md'),
      content: 'x',
      dryRun: true,
    });
    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await existing.text()).toBe(await missing.text());
  });
});

describe('T4 traversal + symlink escape: static app shell', () => {
  const app = defaultApp();

  it.each([
    '/%2e%2e%2fsecret.txt',
    '/..%2f..%2fsecret.txt',
    '/..%5c..%5csecret.txt',
    '/%252e%252e%252fsecret.txt', // double-encoded
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/etc/passwd.txt',
    '/secret.txt',
  ])('traversal probe %s → 400/404, never outside content', async (probe) => {
    const res = await get(app, probe);
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain('root:');
  });

  it('NUL byte in the path → 400', async () => {
    const res = await get(app, '/index%00.html');
    expect(res.status).toBe(400);
  });

  it('symlink inside dist pointing OUT is not followed → 404, no leak', async () => {
    const res = await get(app, '/leak.txt');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('dangling symlink inside dist → 404 (no crash)', async () => {
    expect((await get(app, '/dangling.txt')).status).toBe(404);
  });

  it('symlinked directory inside dist cannot serve escaped files → 404, no leak', async () => {
    const res = await get(app, '/escaped/secret.txt');
    expect([404]).toContain(res.status);
    expect(await res.text()).not.toContain(SECRET);
  });

  it('malformed percent-encoding → 400', async () => {
    expect((await get(app, '/%zz')).status).toBe(400);
  });
});

// ===========================================================================
// T5 — NO ARBITRARY-PATH SCAN / DISK STORM
// ===========================================================================
describe('T5 no arbitrary-path scan or disk storm', () => {
  /** A registry whose store builds/scans are counted, to prove none happen. */
  function countingApp(defaultRoot: string) {
    const builds: string[] = [];
    const scans: string[] = [];
    const registry = new InstanceRegistry('9.9.9', (root) => {
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
    const app = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry,
      version: '9.9.9',
    });
    return { app, builds, scans };
  }

  it('?instance= to /etc, an unknown id, and an unregistered path all → 404, zero scans', async () => {
    const { app, builds, scans } = countingApp(path.join(trees, 'claude-rich'));
    const unregistered = encodeURIComponent(path.join(trees, 'negative-plain'));
    for (const sel of ['%2Fetc', 'deadbeefdeadbeef', unregistered]) {
      expect((await get(app, `/api/report?instance=${sel}`, AUTH)).status).toBe(404);
    }
    expect(builds).toEqual([]); // no unregistered path ever built a store
    expect(scans).toEqual([]);
  });

  it('unload/delete of an unknown instance id → 404', async () => {
    const { app } = countingApp(path.join(trees, 'claude-rich'));
    expect(
      (
        await req(app, '/api/instances/deadbeefdeadbeef/unload', 'POST', {
          ...AUTH,
          origin: ORIGIN,
        })
      ).status,
    ).toBe(404);
    expect(
      (await req(app, '/api/instances/deadbeefdeadbeef', 'DELETE', { ...AUTH, origin: ORIGIN }))
        .status,
    ).toBe(404);
  });

  it('an over-cap (system-root-style) report yields a fast typed error, not a hang', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bigRoot = fs.mkdtempSync(path.join(staticBase, 'overcap-'));
    for (let i = 0; i < 12; i += 1) {
      fs.mkdirSync(path.join(bigRoot, '.claude', `d${i}`), { recursive: true });
      fs.writeFileSync(path.join(bigRoot, '.claude', `d${i}`, 'r.md'), 'x\n');
    }
    // Real ReportStore with a tiny maxDirs standing in for a whole-disk add():
    // proves report becomes E_TOO_MANY_DIRS (→ 500) surfaced cleanly and fast,
    // not a synchronous disk storm.
    const registry = new InstanceRegistry(
      '9.9.9',
      (root, v) => new ReportStore(root, v, { maxDirs: 2 }),
    );
    registry.seed(bigRoot, { makeDefault: true });
    const app = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry,
      version: '9.9.9',
    });

    const started = Date.now();
    const res = await get(app, '/api/report', AUTH);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'report failed' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

// ===========================================================================
// Real server (startServer + raw sockets) for wire-level attacks: bridge
// host-smuggling, WS handshake/frames, bind policy, content over the socket.
// ===========================================================================
describe('wire-level attacks against the real server', () => {
  const socketBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sec-sock-'));
  const socketDist = path.join(socketBase, 'dist');
  fs.mkdirSync(socketDist, { recursive: true });
  fs.writeFileSync(path.join(socketDist, 'index.html'), '<!doctype html><div>shell</div>');
  const started: RunningServer[] = [];

  let server: RunningServer;
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(socketBase, 'proj-'));
    // A config file carrying the canary — for content-discipline over the wire.
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), `# guide\nkey=${SECRET}\n`);
    server = await startServer({ root, distDir: socketDist });
    started.push(server);
  });
  afterAll(async () => {
    await Promise.allSettled(started.map((s) => s.close()));
    fs.rmSync(socketBase, { recursive: true, force: true });
  });

  const bearer = () => `Authorization: Bearer ${server.token}`;
  const okHost = () => `Host: 127.0.0.1:${server.port}`;

  // -------------------------------------------------------------------------
  // T1 (wire): duplicate Host + absolute/authority-form targets.
  // -------------------------------------------------------------------------
  it('T1 duplicate Host header → 400 (a second Host cannot smuggle past the gate)', async () => {
    const reply = await rawHttp(server.port, [
      'GET /api/health HTTP/1.1',
      okHost(),
      'Host: evil.com',
      bearer(),
    ]);
    expect(reply.status).toBe(400);
  });

  it('T1 absolute-form / protocol-relative targets never resolve to a foreign host → 400', async () => {
    for (const target of [
      'http://evil.com/api/report',
      '//evil.com/api/report',
      '/\\evil.com/api/report',
    ]) {
      const reply = await rawHttp(server.port, [`GET ${target} HTTP/1.1`, okHost(), bearer()]);
      expect(reply.status).toBe(400);
      expect(reply.raw).not.toContain('"scope"'); // no report body leaked
    }
  });

  it('T1 spoofed Host over the socket → 403 (DNS-rebinding defense)', async () => {
    for (const host of ['evil.com', `127.0.0.1.evil.com:${server.port}`, `[::1]:${server.port}`]) {
      const reply = await rawHttp(server.port, [
        'GET /api/health HTTP/1.1',
        `Host: ${host}`,
        bearer(),
      ]);
      expect(reply.status).toBe(403);
    }
  });

  it('T3 forbidden method (TRACE) → 405 with no stderr spew (log-flood defense)', async () => {
    const errs: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void errs.push(a.join(' ')));
    try {
      const reply = await rawHttp(server.port, ['TRACE /api/health HTTP/1.1', okHost()]);
      expect(reply.status).toBe(405);
      expect(errs).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('T3 the session token never reaches stdout/stderr', async () => {
    const out: string[] = [];
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...a) => void out.push(a.join(' ')));
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void out.push(a.join(' ')));
    try {
      await (
        await fetch(`http://127.0.0.1:${server.port}/api/report`, {
          headers: { authorization: `Bearer ${server.token}` },
        })
      ).text();
      await fetch(`http://127.0.0.1:${server.port}/api/health`); // 401
      await rawHttp(server.port, ['GET /api/health HTTP/1.1', 'Host: evil.com', bearer()]); // 403
      expect(out.join('\n')).not.toContain(server.token);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // T6 (wire): WS upgrade gates + hostile-frame fail-close + content-free.
  // -------------------------------------------------------------------------
  it('T6 WS upgrade rejected pre-101 on bad Host / Origin / token', async () => {
    const wsOrigin = `http://127.0.0.1:${server.port}`;
    const badHost = await RawWs.open(server.port, {
      host: 'evil.com',
      origin: wsOrigin,
      token: server.token,
    });
    expect(badHost.status).toBe(403);
    expect(badHost.frames).toHaveLength(0);
    badHost.close();

    const badOrigin = await RawWs.open(server.port, {
      origin: 'http://evil.example',
      token: server.token,
    });
    expect(badOrigin.status).toBe(403);
    badOrigin.close();

    const noToken = await RawWs.open(server.port, { origin: wsOrigin });
    expect(noToken.status).toBe(401);
    noToken.close();

    const wrongToken = await RawWs.open(server.port, { origin: wsOrigin, token: 'wrong' });
    expect(wrongToken.status).toBe(401);
    wrongToken.close();
  });

  it('T6 hostile post-handshake frames fail-close (1002/1009) without crashing the server', async () => {
    const wsOrigin = `http://127.0.0.1:${server.port}`;
    const hostile: Array<[string, Buffer, number]> = [
      [
        'unmasked client frame',
        craftFrame({ opcode: 0x1, masked: false, payload: Buffer.from('x') }),
        1002,
      ],
      ['RSV bit set', craftFrame({ opcode: 0x1, rsv: 0b100, payload: Buffer.from('x') }), 1002],
      ['reserved opcode', craftFrame({ opcode: 0x3, payload: Buffer.from('x') }), 1002],
      ['oversized control frame', craftFrame({ opcode: 0x9, payload: Buffer.alloc(126) }), 1002],
    ];
    for (const [, frame, code] of hostile) {
      const ws = await RawWs.open(server.port, { origin: wsOrigin, token: server.token });
      expect(ws.status).toBe(101);
      ws.sendRaw(frame);
      await ws.waitForClose();
      expect(closeCode(ws)).toBe(code);
      ws.close();
    }
    // Oversized inbound (> 1 MiB cap) → 1009, socket dropped.
    const flood = await RawWs.open(server.port, { origin: wsOrigin, token: server.token });
    expect(flood.status).toBe(101);
    flood.sendRaw(Buffer.alloc(1024 * 1024 + 1));
    await flood.waitForClose();
    // Fail-close is the property under test. A flooded socket may be RST before
    // a close frame is read back, and the raw zero-byte flood races the buffer
    // cap (1009) against frame parsing (zeros decode as an unmasked frame →
    // 1002) depending on TCP chunking — so any arriving code must be one of the
    // two fail-close codes (the deterministic 1009 is pinned in ws.test.ts).
    expect(flood.closed).toBe(true);
    const code = closeCode(flood);
    if (code !== undefined) expect([1002, 1009]).toContain(code);
    flood.close();

    // The server is still alive and answering after all the abuse.
    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(health.status).toBe(200);
  });

  it('T6/T8 a WS push after a watched-file change is content-free (no body / patch / secret)', async () => {
    // Load the instance (starts its watcher) via a report request.
    await (
      await fetch(`http://127.0.0.1:${server.port}/api/report`, {
        headers: { authorization: `Bearer ${server.token}` },
      })
    ).text();
    const ws = await RawWs.open(server.port, {
      origin: `http://127.0.0.1:${server.port}`,
      token: server.token,
    });
    expect(ws.status).toBe(101);
    await new Promise((r) => setTimeout(r, 600)); // let chokidar settle
    fs.writeFileSync(path.join(root, '.mcp.json'), `{"note":"${SECRET}"}\n`);
    const text = await ws.waitForText();
    const msg = JSON.parse(text) as { type: string };
    expect(msg.type).toBe('report');
    expect(text).not.toContain(SECRET);
    for (const banned of ['"content"', '"patch"', '"edits"']) expect(text).not.toContain(banned);
    ws.close();
  });

  it('T6 connection cap rejects further upgrades with 503 after auth (real handleUpgrade)', () => {
    // The default cap is 64 (loopback single-user); exercising the real handler
    // with a 1-slot hub proves the cap logic without a 64-socket storm.
    const hub = new WsHub(1);
    // Gate against the REAL server's token (random per launch), not the module
    // constant — the subprotocol below carries server.token.
    const serverTokenHash = createHash('sha256').update(server.token).digest();
    const config = { tokenHash: serverTokenHash, port: () => server.port, hub, path: '/api/ws' };
    const headers = () => ({
      host: `127.0.0.1:${server.port}`,
      origin: `http://127.0.0.1:${server.port}`,
      'sec-websocket-version': '13',
      'sec-websocket-protocol': server.token,
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    });
    const mkReq = () =>
      ({ headers: headers(), url: '/api/ws' }) as unknown as import('node:http').IncomingMessage;
    const sockets: string[] = [];
    const fakeSocket = () => {
      const chunks: string[] = [];
      return {
        obj: {
          on: () => undefined,
          write: (c: unknown) => (chunks.push(String(c)), true),
          destroy: () => undefined,
        } as unknown as import('node:stream').Duplex,
        text: () => chunks.join(''),
      };
    };
    const first = fakeSocket();
    handleUpgrade(mkReq(), first.obj, Buffer.alloc(0), config);
    expect(first.text()).toContain('101');
    const second = fakeSocket();
    handleUpgrade(mkReq(), second.obj, Buffer.alloc(0), config);
    sockets.push(second.text());
    expect(second.text()).toContain('503 Service Unavailable');
    expect(second.text()).not.toContain('101');
  });

  // -------------------------------------------------------------------------
  // T8 (wire): report over the socket is content-free.
  // -------------------------------------------------------------------------
  it('T8 GET /api/report over the socket never contains file content or the planted secret', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/report?scope=project`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    for (const banned of ['"patch"', '"edits"', '"content"']) expect(body).not.toContain(banned);
  });
});

// ===========================================================================
// T7 — BIND POLICY (loopback only, random port; non-localhost impossible)
// ===========================================================================
describe('T7 bind policy: loopback only, non-localhost bind impossible', () => {
  const bindBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-sec-bind-'));
  const bindDist = path.join(bindBase, 'dist');
  fs.mkdirSync(bindDist, { recursive: true });
  fs.writeFileSync(path.join(bindDist, 'index.html'), '<!doctype html><div>shell</div>');
  const started: RunningServer[] = [];
  const start = async () => {
    const root = fs.mkdtempSync(path.join(bindBase, 'proj-'));
    const s = await startServer({ root, distDir: bindDist });
    started.push(s);
    return s;
  };
  afterAll(async () => {
    await Promise.allSettled(started.map((s) => s.close()));
    fs.rmSync(bindBase, { recursive: true, force: true });
  });

  it('refuses to bind any non-loopback host', async () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'localhost']) {
      await expect(startServer({ root: bindBase, host, distDir: bindDist })).rejects.toThrow(
        /loopback/,
      );
    }
  });

  it('binds 127.0.0.1 with a random ephemeral port (two servers differ)', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#token=/);
    expect(a.wsUrl).toBe(`ws://127.0.0.1:${a.port}/api/ws`);
    expect(a.port).toBeGreaterThan(0);
    expect(a.port).not.toBe(b.port);
  });

  it('is not reachable on a routable (non-internal) interface', async () => {
    const server = await start();
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!external) return; // no external interface on this machine
    const net = await import('node:net');
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: external.address, port: server.port, timeout: 1000 });
      socket.on('connect', () => (socket.destroy(), resolve(true)));
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => (socket.destroy(), resolve(false)));
    });
    expect(connected).toBe(false);
  });
});

// ===========================================================================
// T8 — CONTENT DISCIPLINE (report never serializes fix.edits[].patch)
// ===========================================================================
describe('T8 content discipline: report summarizes fixes, never their patch content', () => {
  const app = defaultApp();

  it('a fix-bearing finding reports hasFix/fixKind but NO patch/content/edits anywhere', async () => {
    const res = await get(app, '/api/report?scope=project', AUTH);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    const findings = json['findings'] as Array<{ id: string; hasFix?: boolean; fixKind?: string }>;
    const withFix = findings.find((f) => f.hasFix);
    // claude-rich carries at least one auto-fixable finding; its underlying
    // Finding.fix holds full replacement content — which must NOT be serialized.
    expect(withFix).toBeDefined();
    expect(typeof withFix?.fixKind).toBe('string');
    expect(bannedKeys(json)).toEqual([]);
  });

  it('write dry-run responses expose a diff but never an edits/patch payload of other files', async () => {
    // Plant a canary in a fixture project, then dry-run a create of a DIFFERENT
    // file; the response must carry only the new content, never the canary.
    const projBase = fs.mkdtempSync(path.join(staticBase, 'wdisc-'));
    fs.mkdirSync(path.join(projBase, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projBase, 'CLAUDE.md'), `secret=${SECRET}\n`);
    const scopes: WriteScope[] = [{ root: fs.realpathSync(projBase), kind: 'project' }];
    const wapp = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry: registryFor(projBase),
      version: '9.9.9',
      scopes,
      trashDir: path.join(projBase, 'trash'),
    });
    const res = await req(
      wapp,
      '/api/write',
      'POST',
      { ...AUTH, origin: ORIGIN, 'content-type': 'application/json' },
      { path: '.claude/settings.json', content: '{"a":1}\n', dryRun: true },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json)).not.toContain('edits');
    expect(Object.keys(json)).not.toContain('patch');
    expect(JSON.stringify(json)).not.toContain(SECRET);
  });
});

// ===========================================================================
// T8 — GLOBAL REPORT (agentconfig-71h.2): content-free, fixed roots, no
// instance mixing, apply-fix cannot reach a global finding
// ===========================================================================
describe('T9 global report: scope=global over a FIXTURE home, content-free', () => {
  /**
   * A fixture FAKE home (never the real ~): .claude with a stale model id —
   * which makes stale-model-ref emit a replace-file fix whose patch is the
   * COMPLETE settings.json, canary secret included — plus an oversized
   * .cursor (250 files trips CAPS.maxFiles=200) to prove per-dir isolation.
   */
  function makeGlobalFixture() {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(staticBase, 'fakehome-')));
    const settings = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(
      settings,
      JSON.stringify({ model: 'claude-3-opus-20240229', env: { MY_API_KEY: SECRET } }),
    );
    for (let i = 0; i < 250; i += 1) {
      const file = path.join(home, '.cursor', `r${i}.md`);
      if (i === 0) fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x\n');
    }
    // Runtime-state junk that GLOBAL_SKIP_DIRS must prune from the wire.
    for (const junk of ['projects/session-notes.md', 'paste-cache/p1.txt']) {
      const file = path.join(home, '.claude', junk);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'junk\n');
    }
    const app = createApp({
      tokenHash,
      port: () => PORT,
      distDir: dist,
      registry: registryFor(path.join(trees, 'claude-rich')),
      version: '9.9.9',
      globalStore: new GlobalStore(home, '9.9.9'),
    });
    return { home, settings, app };
  }

  // Incident agentconfig-np8.7: fix.patch once carried the complete source
  // file, including credentials, into a serialized report.
  it('agentconfig-np8.7 fix.patch secret carriage: wire response omits secret and patch keys', async () => {
    const { app } = makeGlobalFixture();
    const res = await get(app, '/api/report?scope=global', AUTH);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(SECRET); // grep the whole wire payload
    const json = JSON.parse(body) as {
      localOnly: boolean;
      entries: { dir: string; findings?: { id: string; hasFix?: boolean }[] }[];
    };
    expect(json.localOnly).toBe(true);
    expect(bannedKeys(json)).toEqual([]); // no patch/content/edits anywhere
    // Skip-dir hygiene holds at the wire: runtime-state junk never serializes.
    expect(body).not.toContain('session-notes.md');
    expect(body).not.toContain('paste-cache');
    // The fix-bearing finding survives only as a summary.
    const claude = json.entries.find((e) => e.dir === '.claude');
    expect(claude?.findings?.some((f) => f.hasFix)).toBe(true);
  });

  it('caps hold per dir: the oversized .cursor is an inline error entry, .claude survives', async () => {
    const { app } = makeGlobalFixture();
    const json = (await (await get(app, '/api/report?scope=global', AUTH)).json()) as {
      entries: ({ dir: string } & Record<string, unknown>)[];
    };
    const cursor = json.entries.find((e) => e.dir === '.cursor');
    expect(cursor).toMatchObject({ error: { name: 'ScanError', code: 'E_TOO_MANY_FILES' } });
    expect('findings' in (cursor as object)).toBe(false);
    const claude = json.entries.find((e) => e.dir === '.claude');
    expect(claude).toHaveProperty('findings'); // healthy sibling still reports
  });

  it('no token → 401; instance mixing → 400 (global is instance-independent)', async () => {
    const { app } = makeGlobalFixture();
    expect((await get(app, '/api/report?scope=global')).status).toBe(401);
    expect(
      (await get(app, '/api/report?scope=global&instance=deadbeefdeadbeef', AUTH)).status,
    ).toBe(400);
  });

  it('apply-fix cannot name a global finding: 404, fixture settings.json untouched', async () => {
    const { settings, app } = makeGlobalFixture();
    const before = fs.readFileSync(settings, 'utf-8');
    // Take the REAL fix-bearing global finding id off the wire, then try to
    // apply it — the fix lives only in the (separate) global store, which
    // apply-fix never consults, so the id is unknown → 404, no oracle.
    const json = (await (await get(app, '/api/report?scope=global', AUTH)).json()) as {
      entries: { findings?: { id: string; hasFix?: boolean }[] }[];
    };
    const globalFinding = json.entries.flatMap((e) => e.findings ?? []).find((f) => f.hasFix) as {
      id: string;
    };
    expect(globalFinding).toBeDefined();
    const res = await req(
      app,
      '/api/apply-fix',
      'POST',
      { ...AUTH, origin: ORIGIN, 'content-type': 'application/json' },
      { findingId: globalFinding.id, dryRun: true },
    );
    expect(res.status).toBe(404);
    expect(fs.readFileSync(settings, 'utf-8')).toBe(before); // nothing applied
  });
});
