/**
 * WS live-update integration (agentconfig-gxo.4): a real node:http server, a
 * hand-rolled raw-socket WS client (no `ws` dep), and real chokidar. Proves the
 * end-to-end path — load an instance (starts its watcher), connect a client,
 * touch a watched config file, and receive a {type:'report'} frame that carries
 * NO file content. Also proves a bad-Origin upgrade is rejected before any frame.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.js';
import { decodeFrames } from './ws.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-ws-int-'));
const dist = path.join(base, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div>shell</div>');

const open: RunningServer[] = [];
async function start(): Promise<{ server: RunningServer; root: string }> {
  const root = fs.mkdtempSync(path.join(base, 'proj-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# hi\n');
  const server = await startServer({ root, distDir: dist });
  open.push(server);
  return { server, root };
}
afterAll(async () => {
  await Promise.allSettled(open.map((s) => s.close()));
  fs.rmSync(base, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A minimal raw-socket WS client: handshake, then collect inbound text frames. */
class WsClient {
  readonly socket: net.Socket;
  status = 0;
  #headerDone = false;
  #buf: Buffer = Buffer.alloc(0);
  readonly texts: string[] = [];
  #waiters: (() => void)[] = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
  }

  static open(port: number, opts: { token?: string; origin?: string }): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        const key = randomBytes(16).toString('base64');
        const lines = [
          'GET /api/ws HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
        ];
        if (opts.origin !== undefined) lines.push(`Origin: ${opts.origin}`);
        if (opts.token !== undefined) lines.push(`Sec-WebSocket-Protocol: ${opts.token}`);
        socket.write(lines.join('\r\n') + '\r\n\r\n');
      });
      const client = new WsClient(socket);
      socket.on('data', (chunk: Buffer) => client.#onData(Buffer.from(chunk)));
      socket.on('error', reject);
      // Resolve once the handshake status line has been parsed.
      const check = setInterval(() => {
        if (client.status !== 0) {
          clearInterval(check);
          resolve(client);
        }
      }, 5);
      setTimeout(() => {
        clearInterval(check);
        if (client.status === 0) reject(new Error('handshake timeout'));
      }, 3000);
    });
  }

  #onData(chunk: Buffer): void {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    if (!this.#headerDone) {
      const idx = this.#buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const header = this.#buf.subarray(0, idx).toString('utf8');
      this.status = Number(/^HTTP\/1\.1 (\d+)/.exec(header)?.[1] ?? 0);
      this.#buf = this.#buf.subarray(idx + 4);
      this.#headerDone = true;
      if (this.status !== 101) return; // rejected — no frames follow
    }
    const { frames, rest } = decodeFrames(this.#buf);
    this.#buf = rest;
    for (const f of frames) {
      if (f.opcode === 0x1) {
        this.texts.push(f.payload.toString('utf8'));
        this.#waiters.splice(0).forEach((w) => w());
      }
    }
  }

  async waitForText(timeoutMs = 4000): Promise<string> {
    if (this.texts.length > 0) return this.texts.shift() as string;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no frame within timeout')), timeoutMs);
      this.#waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
    return this.texts.shift() as string;
  }

  close(): void {
    this.socket.destroy();
  }
}

describe('WS live updates end-to-end', () => {
  it('pushes a content-free {type:report} frame after a watched config change', async () => {
    const { server, root } = await start();
    // Load the instance (this starts its watcher) via a report request.
    const rep = await fetch(`http://127.0.0.1:${server.port}/api/report`, {
      headers: { authorization: `Bearer ${server.token}` },
    });
    expect(rep.status).toBe(200);
    await rep.json(); // drain the body so undici doesn't hold the socket open

    const client = await WsClient.open(server.port, {
      token: server.token,
      origin: `http://127.0.0.1:${server.port}`,
    });
    expect(client.status).toBe(101);

    // Give chokidar a moment to finish its initial scan before touching a file.
    await sleep(600);
    fs.writeFileSync(path.join(root, '.mcp.json'), '{"mcpServers":{}}\n');

    const text = await client.waitForText();
    const msg = JSON.parse(text) as { type: string; instance: string; changed: unknown };
    expect(msg.type).toBe('report');
    expect(typeof msg.instance).toBe('string');
    expect(Array.isArray(msg.changed)).toBe(true);
    // No file content / fix payloads ever cross the WS.
    expect(text).not.toContain('mcpServers');
    for (const banned of ['"content"', '"patch"', '"edits"']) {
      expect(text).not.toContain(banned);
    }
    client.close();
  });

  it('rejects an upgrade with a foreign Origin (no protocol switch, no frames)', async () => {
    const { server } = await start();
    const client = await WsClient.open(server.port, {
      token: server.token,
      origin: 'http://evil.example',
    });
    expect(client.status).toBe(403);
    expect(client.texts).toHaveLength(0);
    client.close();
  });

  it('rejects an upgrade with a missing token → 401', async () => {
    const { server } = await start();
    const client = await WsClient.open(server.port, {
      origin: `http://127.0.0.1:${server.port}`,
    });
    expect(client.status).toBe(401);
    client.close();
  });

  it('exposes a ws:// url on the loopback own-origin', async () => {
    const { server } = await start();
    expect(server.wsUrl).toBe(`ws://127.0.0.1:${server.port}/api/ws`);
  });

  it('close() completes even with a WS client held OPEN across shutdown (hang regression)', async () => {
    // Managed locally (NOT via start()) so afterAll never double-closes it.
    const root = fs.mkdtempSync(path.join(base, 'proj-'));
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# hi\n');
    const server = await startServer({ root, distDir: dist });
    await (
      await fetch(`http://127.0.0.1:${server.port}/api/report`, {
        headers: { authorization: `Bearer ${server.token}` },
      })
    ).json();

    const client = await WsClient.open(server.port, {
      token: server.token,
      origin: `http://127.0.0.1:${server.port}`,
    });
    expect(client.status).toBe(101);

    // Do NOT close the client. An upgraded socket is detached from the http
    // server, so without our explicit destroy server.close() would hang.
    const outcome = await Promise.race([
      server.close().then(() => 'closed'),
      sleep(5000).then(() => 'timeout'),
    ]);
    expect(outcome).toBe('closed');
    client.close();
  });
});
