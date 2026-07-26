/**
 * Raw-socket test helpers for the consolidated security suite
 * (src/server/security.test.ts, bead agentconfig-gxo.5).
 *
 * WHY RAW SOCKETS: undici / global `fetch` cannot forge the wire shapes some
 * threats require — a DUPLICATE `Host` header (RFC 9112 §3.2 request
 * smuggling), an absolute-/authority-form request target (proxy-style host
 * smuggling), or a hand-crafted (mis)masked WebSocket frame. These helpers
 * speak HTTP/1.1 and the RFC 6455 handshake directly over `node:net` so those
 * attacks can be fired at the REAL committed server.
 */

import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { decodeFrames, type DecodedFrame } from './ws.js';

export interface RawResponse {
  /** Parsed status line code, or 0 if none was received. */
  status: number;
  /** The full raw response text (status line + headers + body). */
  raw: string;
}

/**
 * Fire a fully hand-written HTTP/1.1 request over a raw socket and collect the
 * whole response. `lines` are the request/start line plus header lines (no
 * trailing CRLFs); `Connection: close` is appended so the server ends the
 * stream. Duplicate headers, spoofed Host values, and absolute-form targets
 * are all expressible here — that is the point.
 */
export function rawHttp(port: number, lines: string[], body?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      const head = `${lines.join('\r\n')}\r\nConnection: close\r\n`;
      const payload = body === undefined ? '' : body;
      const withLen =
        body === undefined ? head : `${head}Content-Length: ${Buffer.byteLength(payload)}\r\n`;
      socket.write(`${withLen}\r\n${payload}`);
    });
    let data = '';
    socket.setTimeout(4000, () => {
      socket.destroy();
      reject(new Error('rawHttp timeout'));
    });
    socket.on('data', (chunk) => (data += chunk.toString('utf-8')));
    socket.on('end', () => resolve({ status: parseStatus(data), raw: data }));
    socket.on('error', reject);
  });
}

function parseStatus(raw: string): number {
  return Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1] ?? 0);
}

/** Options controlling every field of a raw WebSocket upgrade request. */
export interface RawWsOptions {
  host?: string;
  origin?: string;
  /** Sent as the sole `Sec-WebSocket-Protocol` (the token channel). */
  token?: string;
  version?: string;
  key?: string;
  path?: string;
}

/**
 * A raw-socket WebSocket client that exposes every knob of the handshake and
 * lets tests inject arbitrary post-handshake bytes (hostile frames). It parses
 * the handshake status line, then decodes inbound frames with the server's own
 * `decodeFrames`.
 */
export class RawWs {
  readonly socket: net.Socket;
  status = 0;
  #headerDone = false;
  #buf: Buffer = Buffer.alloc(0);
  readonly texts: string[] = [];
  readonly frames: DecodedFrame[] = [];
  #closed = false;
  #waiters: (() => void)[] = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
  }

  static open(port: number, opts: RawWsOptions): Promise<RawWs> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        const key = opts.key ?? randomBytes(16).toString('base64');
        const lines = [
          `GET ${opts.path ?? '/api/ws'} HTTP/1.1`,
          `Host: ${opts.host ?? `127.0.0.1:${port}`}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          `Sec-WebSocket-Version: ${opts.version ?? '13'}`,
        ];
        if (opts.origin !== undefined) lines.push(`Origin: ${opts.origin}`);
        if (opts.token !== undefined) lines.push(`Sec-WebSocket-Protocol: ${opts.token}`);
        socket.write(lines.join('\r\n') + '\r\n\r\n');
      });
      const client = new RawWs(socket);
      socket.on('data', (chunk: Buffer) => client.#onData(Buffer.from(chunk)));
      socket.on('close', () => {
        client.#closed = true;
        client.#wake();
      });
      socket.on('error', reject);
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
      this.status = parseStatus(header);
      this.#buf = this.#buf.subarray(idx + 4);
      this.#headerDone = true;
      if (this.status !== 101) return; // rejected — no frames follow
    }
    const { frames, rest } = decodeFrames(this.#buf);
    this.#buf = rest;
    for (const f of frames) {
      this.frames.push(f);
      if (f.opcode === 0x1) this.texts.push(f.payload.toString('utf8'));
    }
    if (frames.length > 0) this.#wake();
  }

  #wake(): void {
    // Call every waiter WITHOUT removing it — each waiter self-removes only once
    // its own condition holds (a close frame can arrive just before the socket
    // 'close' event, so a waitForClose waiter must survive the frame #wake).
    for (const w of [...this.#waiters]) w();
  }

  /** True once the socket has fully closed. */
  get closed(): boolean {
    return this.#closed;
  }

  /** Write arbitrary bytes to the socket (used to send hand-crafted frames). */
  sendRaw(buf: Buffer): void {
    this.socket.write(buf);
  }

  /** Resolve when a text frame arrives (or reject on timeout). */
  async waitForText(timeoutMs = 4000): Promise<string> {
    if (this.texts.length > 0) return this.texts.shift() as string;
    await this.#wait(timeoutMs, () => this.texts.length > 0);
    return this.texts.shift() as string;
  }

  /** Resolve when the socket closes (or reject on timeout). */
  async waitForClose(timeoutMs = 4000): Promise<void> {
    if (this.#closed) return;
    await this.#wait(timeoutMs, () => this.#closed);
  }

  #wait(timeoutMs: number, done: () => boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (done()) return resolve();
      const cleanup = () => {
        clearTimeout(t);
        this.#waiters = this.#waiters.filter((w) => w !== tick);
      };
      const t = setTimeout(() => {
        cleanup();
        reject(new Error('wait timeout'));
      }, timeoutMs);
      const tick = () => {
        if (done()) {
          cleanup();
          resolve();
        }
      };
      this.#waiters.push(tick);
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

/**
 * Craft one client→server WebSocket frame with FULL control over the header
 * bits, so a test can send the exact protocol violations the connection must
 * fail-close on: an unmasked frame, an RSV bit set, a reserved opcode, or an
 * oversized control frame. Mirrors the private crafter in ws.test.ts (kept here
 * so the consolidated suite is self-contained and does not import a test file).
 */
export function craftFrame(opts: {
  opcode: number;
  payload?: Buffer;
  masked?: boolean;
  fin?: boolean;
  rsv?: number;
}): Buffer {
  const payload = opts.payload ?? Buffer.alloc(0);
  const masked = opts.masked ?? true;
  const fin = opts.fin ?? true;
  const rsv = opts.rsv ?? 0;
  const b0 = (fin ? 0x80 : 0) | ((rsv & 0x7) << 4) | (opts.opcode & 0x0f);
  const len = payload.length;
  const maskBit = masked ? 0x80 : 0;
  let header: Buffer;
  if (len < 126) header = Buffer.from([b0, maskBit | len]);
  else {
    header = Buffer.alloc(4);
    header[0] = b0;
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  }
  if (!masked) return Buffer.concat([header, payload]);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const m = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) m[i] = (payload[i] as number) ^ (mask[i & 3] as number);
  return Buffer.concat([header, mask, m]);
}

/** The RFC 6455 close code carried in the first close frame `ws` received. */
export function closeCode(ws: RawWs): number | undefined {
  const frame = ws.frames.find((f) => f.opcode === 0x8);
  return frame && frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : undefined;
}
