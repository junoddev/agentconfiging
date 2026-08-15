/**
 * Clean-room WebSocket server (agentconfig-gxo.4) — dependency-free.
 *
 * WHY CLEAN-ROOM (not the `ws` package): the project ethos is lean, pure-JS,
 * no-native-modules deps. Our need is narrow — SERVER→CLIENT text frames for
 * live report pushes, plus enough of RFC 6455 to complete the handshake and
 * behave for ping/close. That is ~150 lines here, so a new dependency is not
 * justified. This implements: the handshake (Sec-WebSocket-Accept =
 * base64(SHA1(key + GUID))), server→client text-frame encoding (unmasked, as
 * the RFC requires for server frames), and client→server frame DECODING only
 * far enough to answer pings, honor close, and drop everything else.
 *
 * WS SECURITY (critical — a WebSocket handshake BYPASSES CORS and the Same-
 * Origin Policy, so none of the browser's cross-origin protections apply). The
 * upgrade is gated with the SAME checks as every /api request (see app.ts):
 *
 *  - Host allowlist (`127.0.0.1:<port>` / `localhost:<port>`) — DNS-rebinding
 *    defense, identical to the HTTP gate.
 *  - Origin allowlist, MANDATORY here (unlike safe HTTP GETs where Origin may
 *    be absent): browsers ALWAYS send Origin on a WS handshake, and WS has no
 *    SOP, so a present-and-correct Origin is the CSRF / DNS-rebinding defense.
 *    A missing or foreign Origin is rejected.
 *  - Bearer token — a browser CANNOT set an Authorization header on a WS
 *    handshake, and the `#token=` URL fragment is never sent to the server, so
 *    the token travels in `Sec-WebSocket-Protocol` (a subprotocol value). It is
 *    compared constant-time (SHA-256 + timingSafeEqual, same as app.ts) and,
 *    on success, echoed back as the negotiated subprotocol. A `?token=` query
 *    is deliberately NOT accepted (query strings leak into logs/history).
 *
 * A failed gate rejects the upgrade with a plain HTTP error BEFORE switching
 * protocols — no WS frame is ever written to an unauthorized socket.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** RFC 6455 §1.3 magic GUID appended to the client key before hashing. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Opcodes we care about (RFC 6455 §5.2). */
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Hard cap on buffered inbound bytes; a client that floods us is closed. */
const MAX_INBOUND_BYTES = 1024 * 1024;

/** Hard cap on buffered OUTBOUND bytes; a slow client is dropped, not queued. */
const MAX_OUTBOUND_BYTES = 1024 * 1024;

/** RFC 6455 close codes we emit. */
const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_TOO_BIG = 1009;

/** Default cap on concurrent connections (loopback, single user — generous). */
export const DEFAULT_MAX_CONNECTIONS = 64;

/** Sec-WebSocket-Accept = base64(SHA1(Sec-WebSocket-Key + GUID)). */
export function computeAcceptKey(secWebSocketKey: string): string {
  return createHash('sha1')
    .update(secWebSocketKey + WS_GUID)
    .digest('base64');
}

/** Encode one server→client frame (FIN set, never masked — RFC 6455 §5.1). */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  const b0 = 0x80 | (opcode & 0x0f);
  if (len < 126) {
    header = Buffer.from([b0, len]);
  } else if (len < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = b0;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = b0;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Encode a UTF-8 text frame — the only payload kind we ever send. */
export function encodeTextFrame(text: string): Buffer {
  return encodeFrame(OP_TEXT, Buffer.from(text, 'utf8'));
}

/** Encode a close frame carrying a 2-byte status code (RFC 6455 §5.5.1). */
export function encodeCloseFrame(code: number = CLOSE_NORMAL): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return encodeFrame(OP_CLOSE, payload);
}

export interface DecodedFrame {
  /** FIN bit — false marks a fragment continuation follows. */
  fin: boolean;
  /** RSV1..3 bits (§5.2); MUST be 0 with no negotiated extension. */
  rsv: number;
  /** Mask bit — client→server frames MUST set it (§5.3). */
  masked: boolean;
  opcode: number;
  payload: Buffer;
}

/**
 * Decode as many complete frames as `buf` contains. Client→server frames MUST
 * be masked (RFC 6455 §5.3); we unmask them. The decoder is purely mechanical
 * — it surfaces fin/rsv/masked so the CONNECTION can enforce the protocol
 * (fail-close on unmasked / RSV / bad opcode). Returns the decoded frames and
 * the trailing bytes of an incomplete frame (to be prepended to the next read).
 */
export function decodeFrames(buf: Buffer): { frames: DecodedFrame[]; rest: Buffer } {
  const frames: DecodedFrame[] = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b0 = buf[offset] as number;
    const b1 = buf[offset + 1] as number;
    const fin = (b0 & 0x80) !== 0;
    const rsv = (b0 & 0x70) >> 4;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buf.length) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    let mask: Buffer | undefined;
    if (masked) {
      if (pos + 4 > buf.length) break;
      mask = buf.subarray(pos, pos + 4);
      pos += 4;
    }
    if (pos + len > buf.length) break; // frame not fully arrived yet
    let payload = buf.subarray(pos, pos + len);
    if (mask) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) out[i] = (payload[i] as number) ^ (mask[i & 3] as number);
      payload = out;
    }
    frames.push({ fin, rsv, masked, opcode, payload: Buffer.from(payload) });
    offset = pos + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

/**
 * RFC 6455 validation of a CLIENT→server frame. Returns true if the frame
 * violates the protocol and the connection must be failed (§5.1/5.2/5.4/5.5.2):
 *  - unmasked (clients MUST mask);
 *  - any RSV bit set (we negotiate no extensions);
 *  - an opcode outside {text, binary, close, ping, pong} — note continuation
 *    (0x0) is rejected: we neither send nor reassemble fragmented messages, so
 *    a continuation frame is always unexpected;
 *  - a control frame (close/ping/pong) that is fragmented or > 125 bytes (§5.5).
 */
function frameIsInvalid(f: DecodedFrame): boolean {
  if (!f.masked) return true;
  if (f.rsv !== 0) return true;
  const knownData = f.opcode === OP_TEXT || f.opcode === OP_BINARY;
  const knownControl = f.opcode === OP_CLOSE || f.opcode === OP_PING || f.opcode === OP_PONG;
  if (!knownData && !knownControl) return true;
  if (knownControl && (!f.fin || f.payload.length > 125)) return true;
  return false;
}

/**
 * One upgraded WebSocket connection. We only ever PUSH text frames; inbound
 * frames are decoded only to answer pings and honor close — text/binary/pong
 * payloads are ignored (never interpreted or executed).
 */
export class WsConnection {
  readonly #socket: Duplex;
  #buf: Buffer = Buffer.alloc(0);
  #closed = false;
  #notified = false;
  /** Fired exactly once when the socket is gone (used by the hub to evict). */
  onClose?: () => void;

  constructor(socket: Duplex, head?: Buffer) {
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => this.#onData(chunk));
    socket.on('close', () => this.#markClosed());
    socket.on('error', () => this.#markClosed());
    socket.on('end', () => this.#markClosed());
    if (head && head.length > 0) this.#onData(head);
  }

  #onData(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buf = Buffer.concat([this.#buf, chunk]);
    if (this.#buf.length > MAX_INBOUND_BYTES) {
      // Flood / oversized frame: drop the client (1009 message too big).
      this.close(CLOSE_TOO_BIG);
      return;
    }
    const { frames, rest } = decodeFrames(this.#buf);
    this.#buf = rest;
    for (const frame of frames) {
      if (frameIsInvalid(frame)) {
        // Fail the connection on any RFC 6455 violation (§5.1/5.2/5.4/5.5.2).
        this.close(CLOSE_PROTOCOL_ERROR);
        return;
      }
      if (frame.opcode === OP_CLOSE) {
        this.close(CLOSE_NORMAL);
        return;
      }
      if (frame.opcode === OP_PING) {
        // Pong payload is bounded to ≤125 bytes (control-frame rule enforced
        // above), and inbound bytes are capped, so ping→pong cannot amplify.
        this.#write(encodeFrame(OP_PONG, frame.payload));
      }
      // OP_TEXT / OP_BINARY / OP_PONG: accepted but ignored by design.
    }
  }

  /** Push a JSON/text message. No-op once closed. */
  send(text: string): void {
    if (this.#closed) return;
    this.#write(encodeTextFrame(text));
  }

  #write(buf: Buffer): void {
    if (this.#closed) return;
    try {
      const ok = this.#socket.write(buf);
      // Backpressure: if the kernel buffer is full AND our queued bytes exceed
      // the cap, the client is too slow — drop it rather than buffer unbounded.
      if (ok === false && this.#socket.writableLength > MAX_OUTBOUND_BYTES) {
        this.close(CLOSE_TOO_BIG);
      }
    } catch {
      this.#markClosed();
    }
  }

  /**
   * Send a close frame (with `code`) and tear the socket down (idempotent,
   * fires onClose). We DESTROY rather than half-close (`end()`): an upgraded WS
   * socket is detached from the http server, so a lingering half-open socket
   * would keep `server.close()` waiting forever at shutdown. The close frame is
   * written first (delivered on loopback); a forcible teardown at close time is
   * fine — the client reconnects/refetches, it never needs a clean handshake.
   */
  close(code: number = CLOSE_NORMAL): void {
    if (this.#closed) {
      this.#markClosed();
      return;
    }
    this.#closed = true;
    try {
      this.#socket.write(encodeCloseFrame(code));
    } catch {
      // socket already gone
    }
    try {
      this.#socket.destroy();
    } catch {
      // ignore
    }
    this.#markClosed();
  }

  #markClosed(): void {
    this.#closed = true;
    if (this.#notified) return;
    this.#notified = true;
    this.onClose?.();
  }
}

/** Tracks live connections and fans a message out to all of them. */
export class WsHub {
  readonly #conns = new Set<WsConnection>();
  readonly #max: number;

  constructor(maxConnections: number = DEFAULT_MAX_CONNECTIONS) {
    this.#max = maxConnections;
  }

  /** The connection cap; further upgrades are rejected (503) while at it. */
  get capacity(): number {
    return this.#max;
  }

  /** True when the cap is reached — the upgrade handler rejects with 503. */
  isFull(): boolean {
    return this.#conns.size >= this.#max;
  }

  add(conn: WsConnection): void {
    this.#conns.add(conn);
    conn.onClose = () => this.#conns.delete(conn);
  }

  /** Serialize `message` once and push it to every open connection. */
  broadcast(message: unknown): void {
    if (this.#conns.size === 0) return;
    const text = JSON.stringify(message);
    for (const conn of this.#conns) conn.send(text);
  }

  get size(): number {
    return this.#conns.size;
  }

  /** Close and drop every connection (server shutdown / teardown). */
  closeAll(): void {
    for (const conn of [...this.#conns]) conn.close();
    this.#conns.clear();
  }
}

/** Constant-time bearer check: SHA-256 both sides, timingSafeEqual on digests. */
function tokenMatches(presented: string | undefined, tokenHash: Buffer): boolean {
  const digest = createHash('sha256')
    .update(presented ?? '')
    .digest();
  return timingSafeEqual(digest, tokenHash);
}

/** First subprotocol offered in Sec-WebSocket-Protocol (comma-separated list). */
function firstSubprotocol(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.trim();
  return first ? first : undefined;
}

export interface WsGateConfig {
  /** SHA-256 digest of the session token (never the raw token). */
  tokenHash: Buffer;
  /** Late-resolved bound port (0 until listen → everything fails closed). */
  port: () => number;
  /** Explicit unsafe mode: accept arbitrary Host and Origin values. */
  acceptAll?: boolean;
}

export type UpgradeDecision =
  | { ok: true; acceptKey: string; subprotocol: string }
  | { ok: false; status: 400 | 401 | 403 | 426 };

/**
 * Apply the /api gates to a WS upgrade request (see the module header). Order
 * mirrors app.ts: Host, Origin (MANDATORY for WS), protocol version, then
 * token. Returns the accept key + echoed subprotocol on success, or a status
 * to reject with. (The connection-cap 503 is enforced in handleUpgrade.)
 */
export function authorizeUpgrade(req: IncomingMessage, config: WsGateConfig): UpgradeDecision {
  const port = config.port();
  const host = req.headers.host;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!config.acceptAll && (!host || !allowedHosts.has(host.toLowerCase()))) {
    return { ok: false, status: 403 };
  }

  // Origin is mandatory here: browsers always send it on a WS handshake, and
  // WS has no Same-Origin Policy, so a correct Origin is the CSRF defense.
  const origin = req.headers.origin;
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (!config.acceptAll && (!origin || !allowedOrigins.has(origin.toLowerCase()))) {
    return { ok: false, status: 403 };
  }

  // Only RFC 6455 (version 13) is supported; anything else → 426 (the reject
  // response advertises `Sec-WebSocket-Version: 13`).
  if (req.headers['sec-websocket-version'] !== '13') return { ok: false, status: 426 };

  const token = firstSubprotocol(req.headers['sec-websocket-protocol']);
  if (!tokenMatches(token, config.tokenHash)) return { ok: false, status: 401 };

  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || key.trim() === '') return { ok: false, status: 400 };

  // token is defined here (tokenMatches('') can only pass against a hash of '',
  // which the server never uses), so echo it back as the negotiated protocol.
  return { ok: true, acceptKey: computeAcceptKey(key), subprotocol: token as string };
}

function handshakeResponse(acceptKey: string, subprotocol: string): string {
  return (
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      `Sec-WebSocket-Protocol: ${subprotocol}`,
    ].join('\r\n') + '\r\n\r\n'
  );
}

type RejectStatus = 400 | 401 | 403 | 404 | 426 | 503;

const REJECT_TEXT: Record<RejectStatus, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  426: 'Upgrade Required',
  503: 'Service Unavailable',
};

/** Reject an upgrade with a plain HTTP error — no protocol switch, no frames. */
function rejectUpgrade(socket: Duplex, status: RejectStatus): void {
  // A 426 MUST advertise the supported version (RFC 6455 §4.4).
  const extra = status === 426 ? 'Sec-WebSocket-Version: 13\r\n' : '';
  try {
    socket.write(
      `HTTP/1.1 ${status} ${REJECT_TEXT[status]}\r\n${extra}Connection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    // socket already gone
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
}

export interface UpgradeHandlerConfig extends WsGateConfig {
  hub: WsHub;
  /** Path the WS lives at; anything else is a 404 upgrade. Default /api/ws. */
  path?: string;
}

/**
 * Handle a node http 'upgrade' event: gate it, complete the handshake, and
 * register the connection with the hub. Never throws — a bad handshake becomes
 * an HTTP rejection and the socket is destroyed.
 */
export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: UpgradeHandlerConfig,
): void {
  // A socket error mid-handshake must not crash the server.
  socket.on('error', () => {
    /* swallow — connection is being torn down */
  });
  const pathname = (req.url ?? '/').split('?')[0];
  if (pathname !== (config.path ?? '/api/ws')) {
    rejectUpgrade(socket, 404);
    return;
  }
  const decision = authorizeUpgrade(req, config);
  if (!decision.ok) {
    rejectUpgrade(socket, decision.status);
    return;
  }
  // Connection cap (503): loopback single-user, but bound it anyway so a bug or
  // a local process cannot open unbounded sockets. Checked AFTER auth so an
  // unauthenticated caller learns nothing about capacity.
  if (config.hub.isFull()) {
    rejectUpgrade(socket, 503);
    return;
  }
  socket.write(handshakeResponse(decision.acceptKey, decision.subprotocol));
  config.hub.add(new WsConnection(socket, head));
}
