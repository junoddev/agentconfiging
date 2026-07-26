/**
 * Integration tests for startServer (agentconfig-gxo.2): a real node:http
 * socket on 127.0.0.1, exercised with global fetch and raw sockets. Pins the
 * launch-URL/token contract, loopback-only binding, random-port behavior,
 * the bridge end-to-end, and close() releasing the port.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startServer, type RunningServer } from './index.js';

const trees = path.resolve(process.cwd(), 'fixtures/trees');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-server-int-'));
const dist = path.join(base, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div>shell</div>');

const open: RunningServer[] = [];
async function start(root = path.join(trees, 'negative-plain')): Promise<RunningServer> {
  const server = await startServer({ root, distDir: dist });
  open.push(server);
  return server;
}
afterAll(async () => {
  await Promise.allSettled(open.map((s) => s.close()));
  fs.rmSync(base, { recursive: true, force: true });
});

/** Raw HTTP/1.1 exchange so we can send arbitrary (spoofed) Host headers. */
function rawRequest(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${lines.join('\r\n')}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('utf-8')));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('startServer contract', () => {
  it('returns url with embedded fragment token, port, token, close', async () => {
    const server = await start();
    const match = /^http:\/\/127\.0\.0\.1:(\d+)\/#token=([A-Za-z0-9_-]+)$/.exec(server.url);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(server.port);
    expect(match?.[2]).toBe(server.token);
    expect(server.token.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
    expect(server.port).toBeGreaterThan(0);
  });

  it('rejects non-loopback bind hosts', async () => {
    await expect(startServer({ root: base, host: '0.0.0.0' })).rejects.toThrow(/loopback/);
  });

  it('OS-assigned ports are random-ish: two concurrent servers differ', async () => {
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.port).not.toBe(b.port);
  });

  it('binds loopback only: a non-internal interface refuses the connection', async () => {
    const server = await start();
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!external) return; // no external interface on this machine — nothing to probe
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: external.address, port: server.port, timeout: 1000 });
      socket.on('connect', () => (socket.destroy(), resolve(true)));
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => (socket.destroy(), resolve(false)));
    });
    expect(connected).toBe(false);
  });

  it('close() releases the port and stops answering', async () => {
    const server = await startServer({ root: path.join(trees, 'negative-plain'), distDir: dist });
    const { port, token } = server;
    const ok = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);

    await server.close();
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();

    // The port is actually free again: we can bind it ourselves.
    await new Promise<void>((resolve, reject) => {
      const reuse = net.createServer();
      reuse.once('error', reject);
      reuse.listen(port, '127.0.0.1', () => reuse.close(() => resolve()));
    });
  });
});

describe('end-to-end over the socket', () => {
  it('health and report succeed with the bearer token; report is content-free', async () => {
    const server = await start(path.join(trees, 'claude-rich'));
    const auth = { authorization: `Bearer ${server.token}` };
    const health = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/health`, { headers: auth })
    ).json()) as Record<string, unknown>;
    expect(health['ok']).toBe(true);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/report?scope=project`, {
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('"patch"');
    expect(body).not.toContain('"edits"');
    const json = JSON.parse(body) as { scope: string; findings: unknown[] };
    expect(json.scope).toBe('project');
    expect(json.findings.length).toBeGreaterThan(0);
  });

  it('missing token → 401; evil Origin → 403; static shell needs no token', async () => {
    const server = await start();
    const url = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${url}/api/health`)).status).toBe(401);
    const evil = await fetch(`${url}/api/health`, {
      headers: { authorization: `Bearer ${server.token}`, origin: 'http://evil.com' },
    });
    expect(evil.status).toBe(403);
    const shell = await fetch(`${url}/`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain('shell');
  });

  it('spoofed Host over a raw socket → 403 (DNS-rebinding defense)', async () => {
    const server = await start();
    for (const host of ['evil.com', `127.0.0.1.evil.com:${server.port}`, `[::1]:${server.port}`]) {
      const reply = await rawRequest(server.port, [
        'GET /api/health HTTP/1.1',
        `Host: ${host}`,
        `Authorization: Bearer ${server.token}`,
      ]);
      expect(reply).toMatch(/^HTTP\/1\.1 403 /);
    }
  });

  it('protocol-relative targets never resolve to a foreign host → 400', async () => {
    const server = await start();
    // Both "//evil.com/..." and "/\evil.com/..." (backslash-normalized to //).
    for (const target of ['//evil.com/api/report', '/\\evil.com/api/report']) {
      const reply = await rawRequest(server.port, [
        `GET ${target} HTTP/1.1`,
        `Host: 127.0.0.1:${server.port}`,
        `Authorization: Bearer ${server.token}`,
      ]);
      expect(reply).toMatch(/^HTTP\/1\.1 400 /);
      expect(reply).not.toContain('"scope"'); // no report body leaked
    }
  });

  it('duplicate Host headers → 400 (second header cannot smuggle past the gate)', async () => {
    const server = await start();
    const reply = await rawRequest(server.port, [
      'GET /api/health HTTP/1.1',
      `Host: 127.0.0.1:${server.port}`,
      'Host: evil.com',
      `Authorization: Bearer ${server.token}`,
    ]);
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
  });

  it('forbidden method (TRACE) → 405 with no stderr spew (log-flood defense)', async () => {
    const errs: string[] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void errs.push(a.join(' ')));
    try {
      const server = await start();
      const reply = await rawRequest(server.port, [
        'TRACE /api/health HTTP/1.1',
        `Host: 127.0.0.1:${server.port}`,
      ]);
      expect(reply).toMatch(/^HTTP\/1\.1 405 /);
      expect(errs).toEqual([]); // client-triggered bad input must not log
    } finally {
      spy.mockRestore();
    }
  });

  it('the session token never appears on stdout/stderr from the library path', async () => {
    const out: string[] = [];
    const logSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((...a) => void out.push(a.join(' ')));
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...a) => void out.push(a.join(' ')));
    try {
      const server = await startServer({ root: path.join(trees, 'claude-rich'), distDir: dist });
      open.push(server);
      // Exercise success + failure + rejected requests: none may print the token.
      await fetch(`http://127.0.0.1:${server.port}/api/report`, {
        headers: { authorization: `Bearer ${server.token}` },
      });
      await fetch(`http://127.0.0.1:${server.port}/api/health`); // 401
      await rawRequest(server.port, [
        'GET /api/health HTTP/1.1',
        'Host: evil.com',
        `Authorization: Bearer ${server.token}`,
      ]); // 403
      expect(out.join('\n')).not.toContain(server.token);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
