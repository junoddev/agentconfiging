/**
 * Clean-room WebSocket unit tests (agentconfig-gxo.4): the RFC 6455 accept-key
 * vector, frame encode/decode round-trips (masked client frames included), the
 * upgrade auth gates (Host / Origin / token — WS bypasses CORS so these ARE the
 * defense), ping→pong, close teardown, and hub broadcast.
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  WsConnection,
  WsHub,
  authorizeUpgrade,
  computeAcceptKey,
  decodeFrames,
  encodeFrame,
  encodeTextFrame,
  handleUpgrade,
} from './ws.js';

/** A minimal in-memory Duplex stand-in that records what was written. */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  ended = false;
  destroyed = false;
  /** Backpressure knobs (Duplex.writableLength / write() return value). */
  writableLength = 0;
  writeReturn = true;
  write(chunk: Buffer | string): boolean {
    this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return this.writeReturn;
  }
  end(): void {
    this.ended = true;
    this.emit('close');
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
  asDuplex(): Duplex {
    return this as unknown as Duplex;
  }
  allWritten(): Buffer {
    return Buffer.concat(this.written);
  }
}

/** Craft a raw frame with full control over the header bits (for hostile input). */
function craftFrame(opts: {
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
  for (let i = 0; i < len; i += 1) m[i] = payload[i]! ^ mask[i & 3]!;
  return Buffer.concat([header, mask, m]);
}

/** A valid MASKED client→server frame. */
const encodeClientFrame = (opcode: number, payload: Buffer): Buffer =>
  craftFrame({ opcode, payload });

/** The close code carried in the (first) close frame the connection wrote. */
function closeCodeWritten(socket: FakeSocket): number | undefined {
  const frame = decodeFrames(socket.allWritten()).frames.find((f) => f.opcode === 0x8);
  return frame && frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : undefined;
}

const TOKEN = 'sess-token-sess-token-sess-token-sess-token';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const PORT = 8899;

function fakeReq(headers: Record<string, string>): IncomingMessage {
  return { headers, url: '/api/ws' } as unknown as IncomingMessage;
}
const validHeaders = () => ({
  host: `127.0.0.1:${PORT}`,
  origin: `http://127.0.0.1:${PORT}`,
  'sec-websocket-version': '13',
  'sec-websocket-protocol': TOKEN,
  'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
});

describe('computeAcceptKey (RFC 6455 test vector)', () => {
  it('maps the canonical key to the canonical accept value', () => {
    expect(computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('frame encode/decode round-trip', () => {
  it('round-trips an unmasked server text frame', () => {
    const { frames, rest } = decodeFrames(encodeTextFrame('hello ☃'));
    expect(rest.length).toBe(0);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.opcode).toBe(0x1);
    expect(frames[0]!.payload.toString('utf8')).toBe('hello ☃');
  });

  it('decodes and unmasks a client frame, and a 126-length extended frame', () => {
    const big = Buffer.alloc(200, 0x41); // > 125 → 16-bit length path
    const { frames } = decodeFrames(encodeClientFrame(0x1, big));
    expect(frames[0]!.payload.equals(big)).toBe(true);
  });

  it('returns the trailing partial frame as rest (no false decode)', () => {
    const full = encodeTextFrame('abc');
    const partial = full.subarray(0, full.length - 1);
    const { frames, rest } = decodeFrames(partial);
    expect(frames).toHaveLength(0);
    expect(rest.length).toBe(partial.length);
  });
});

describe('authorizeUpgrade gates (WS bypasses CORS — these are the defense)', () => {
  const config = { tokenHash, port: () => PORT };

  it('accepts a valid upgrade and echoes the token as the subprotocol', () => {
    const decision = authorizeUpgrade(fakeReq(validHeaders()), config);
    expect(decision).toEqual({
      ok: true,
      acceptKey: 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
      subprotocol: TOKEN,
    });
  });

  it('rejects a missing/wrong token → 401', () => {
    const h = validHeaders();
    delete (h as Record<string, string>)['sec-websocket-protocol'];
    expect(authorizeUpgrade(fakeReq(h), config)).toEqual({ ok: false, status: 401 });
    expect(
      authorizeUpgrade(fakeReq({ ...validHeaders(), 'sec-websocket-protocol': 'wrong' }), config),
    ).toEqual({ ok: false, status: 401 });
  });

  it('rejects a missing or foreign Origin → 403 (mandatory for WS)', () => {
    const h = validHeaders();
    delete (h as Record<string, string>).origin;
    expect(authorizeUpgrade(fakeReq(h), config)).toEqual({ ok: false, status: 403 });
    expect(
      authorizeUpgrade(fakeReq({ ...validHeaders(), origin: 'http://evil.example' }), config),
    ).toEqual({ ok: false, status: 403 });
  });

  it('rejects a foreign Host → 403 (DNS-rebinding defense)', () => {
    expect(authorizeUpgrade(fakeReq({ ...validHeaders(), host: 'evil.example' }), config)).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('rejects a missing Sec-WebSocket-Key → 400', () => {
    const h = validHeaders();
    delete (h as Record<string, string>)['sec-websocket-key'];
    expect(authorizeUpgrade(fakeReq(h), config)).toEqual({ ok: false, status: 400 });
  });

  it('rejects a missing/unsupported Sec-WebSocket-Version → 426', () => {
    const h = validHeaders();
    delete (h as Record<string, string>)['sec-websocket-version'];
    expect(authorizeUpgrade(fakeReq(h), config)).toEqual({ ok: false, status: 426 });
    expect(
      authorizeUpgrade(fakeReq({ ...validHeaders(), 'sec-websocket-version': '8' }), config),
    ).toEqual({ ok: false, status: 426 });
  });
});

describe('WsConnection', () => {
  it('answers a client ping with a pong carrying the same payload', () => {
    const socket = new FakeSocket();
    new WsConnection(socket.asDuplex());
    socket.emit('data', encodeClientFrame(0x9, Buffer.from('pingdata')));
    const { frames } = decodeFrames(socket.allWritten());
    expect(frames).toHaveLength(1);
    expect(frames[0]!.opcode).toBe(0xa); // pong
    expect(frames[0]!.payload.toString()).toBe('pingdata');
  });

  it('a client close frame triggers a close frame + end + onClose (once)', () => {
    const socket = new FakeSocket();
    const conn = new WsConnection(socket.asDuplex());
    const onClose = vi.fn();
    conn.onClose = onClose;
    socket.emit('data', encodeClientFrame(0x8, Buffer.alloc(0)));
    expect(socket.destroyed).toBe(true);
    const { frames } = decodeFrames(socket.allWritten());
    expect(frames.some((f) => f.opcode === 0x8)).toBe(true);
    // A subsequent socket 'close' must not fire onClose twice.
    socket.emit('close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('send() after close is a no-op', () => {
    const socket = new FakeSocket();
    const conn = new WsConnection(socket.asDuplex());
    conn.close();
    socket.written = [];
    conn.send('late');
    expect(socket.written).toHaveLength(0);
  });
});

describe('WsConnection RFC 6455 hardening (fail-close on hostile frames)', () => {
  const hostile: Array<[string, Buffer]> = [
    [
      'an unmasked client frame (§5.1)',
      craftFrame({ opcode: 0x1, masked: false, payload: Buffer.from('x') }),
    ],
    [
      'a frame with an RSV bit set (§5.2)',
      craftFrame({ opcode: 0x1, rsv: 0b100, payload: Buffer.from('x') }),
    ],
    ['an invalid opcode (§5.2)', craftFrame({ opcode: 0x3, payload: Buffer.from('x') })],
    [
      'an unexpected continuation frame (§5.4)',
      craftFrame({ opcode: 0x0, payload: Buffer.from('x') }),
    ],
    ['an oversized control frame (§5.5)', craftFrame({ opcode: 0x9, payload: Buffer.alloc(126) })],
    ['a fragmented control frame (§5.5)', craftFrame({ opcode: 0x9, fin: false })],
  ];

  for (const [label, frame] of hostile) {
    it(`closes the connection (1002) on ${label}`, () => {
      const socket = new FakeSocket();
      new WsConnection(socket.asDuplex());
      socket.emit('data', frame);
      expect(socket.destroyed).toBe(true);
      expect(closeCodeWritten(socket)).toBe(1002);
    });
  }

  it('closes (1009) when inbound bytes exceed the 1MB cap', () => {
    const socket = new FakeSocket();
    new WsConnection(socket.asDuplex());
    socket.emit('data', Buffer.alloc(1024 * 1024 + 1)); // > MAX_INBOUND_BYTES
    expect(socket.destroyed).toBe(true);
    expect(closeCodeWritten(socket)).toBe(1009);
  });

  it('drops a slow client (1009) when the outbound buffer exceeds the cap', () => {
    const socket = new FakeSocket();
    socket.writeReturn = false; // kernel buffer full
    socket.writableLength = 2 * 1024 * 1024; // queued beyond the 1MB cap
    const conn = new WsConnection(socket.asDuplex());
    conn.send('backed-up');
    expect(socket.destroyed).toBe(true);
  });
});

describe('WsHub', () => {
  it('broadcasts one JSON text frame to every open connection and evicts on close', () => {
    const hub = new WsHub();
    const s1 = new FakeSocket();
    const s2 = new FakeSocket();
    const c1 = new WsConnection(s1.asDuplex());
    const c2 = new WsConnection(s2.asDuplex());
    hub.add(c1);
    hub.add(c2);
    expect(hub.size).toBe(2);

    hub.broadcast({ type: 'report', changed: ['finding-added:x'] });
    for (const s of [s1, s2]) {
      const { frames } = decodeFrames(s.allWritten());
      const text = frames.find((f) => f.opcode === 0x1)!.payload.toString('utf8');
      expect(JSON.parse(text)).toEqual({ type: 'report', changed: ['finding-added:x'] });
    }

    c1.close();
    expect(hub.size).toBe(1);
  });

  it('closeAll() closes and drops every connection', () => {
    const hub = new WsHub();
    const socket = new FakeSocket();
    hub.add(new WsConnection(socket.asDuplex()));
    hub.closeAll();
    expect(hub.size).toBe(0);
    expect(socket.destroyed).toBe(true);
  });

  it('reports its capacity and isFull() at the cap', () => {
    const hub = new WsHub(2);
    expect(hub.capacity).toBe(2);
    expect(hub.isFull()).toBe(false);
    hub.add(new WsConnection(new FakeSocket().asDuplex()));
    hub.add(new WsConnection(new FakeSocket().asDuplex()));
    expect(hub.isFull()).toBe(true);
  });
});

describe('handleUpgrade', () => {
  const config = (hub: WsHub) => ({ tokenHash, port: () => PORT, hub, path: '/api/ws' });

  it('completes the handshake (101) and registers a valid upgrade', () => {
    const hub = new WsHub();
    const socket = new FakeSocket();
    handleUpgrade(fakeReq(validHeaders()), socket.asDuplex(), Buffer.alloc(0), config(hub));
    expect(socket.allWritten().toString('utf8')).toContain('101 Switching Protocols');
    expect(hub.size).toBe(1);
  });

  it('rejects with 503 once the connection cap is reached (no handshake)', () => {
    const hub = new WsHub(1);
    handleUpgrade(
      fakeReq(validHeaders()),
      new FakeSocket().asDuplex(),
      Buffer.alloc(0),
      config(hub),
    );
    expect(hub.isFull()).toBe(true);

    const socket = new FakeSocket();
    handleUpgrade(fakeReq(validHeaders()), socket.asDuplex(), Buffer.alloc(0), config(hub));
    const response = socket.allWritten().toString('utf8');
    expect(response).toContain('503 Service Unavailable');
    expect(response).not.toContain('101');
    expect(socket.destroyed).toBe(true);
    expect(hub.size).toBe(1); // not added
  });

  it('rejects a foreign path with 404 (no auth probe)', () => {
    const hub = new WsHub();
    const socket = new FakeSocket();
    const req = { headers: validHeaders(), url: '/api/other' } as unknown as IncomingMessage;
    handleUpgrade(req, socket.asDuplex(), Buffer.alloc(0), config(hub));
    expect(socket.allWritten().toString('utf8')).toContain('404 Not Found');
    expect(hub.size).toBe(0);
  });

  it('rejects an unsupported version with 426 advertising version 13', () => {
    const hub = new WsHub();
    const socket = new FakeSocket();
    const h = validHeaders();
    delete (h as Record<string, string>)['sec-websocket-version'];
    handleUpgrade(fakeReq(h), socket.asDuplex(), Buffer.alloc(0), config(hub));
    const response = socket.allWritten().toString('utf8');
    expect(response).toContain('426 Upgrade Required');
    expect(response).toContain('Sec-WebSocket-Version: 13');
    expect(hub.size).toBe(0);
  });
});

describe('encodeFrame length encodings', () => {
  it('uses the 64-bit length path for very large payloads', () => {
    const payload = Buffer.alloc(70000, 0x42);
    const framed = encodeFrame(0x2, payload);
    expect(framed[1]! & 0x7f).toBe(127);
    const { frames } = decodeFrames(framed);
    expect(frames[0]!.payload.length).toBe(70000);
  });
});
