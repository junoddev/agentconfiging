/**
 * Live-updates WebSocket client (SPEC §4.4). Connects to `ws://<host>/api/ws`
 * with the session token as the sole `Sec-WebSocket-Protocol` subprotocol — a WS
 * handshake carries no Authorization header and the URL fragment never reaches
 * the server, so the subprotocol is the token channel (see src/server/ws.ts).
 *
 * The socket drives two things:
 *   - the LIVE indicator: `connected` ⇒ LIVE pulse, otherwise OFFLINE;
 *   - report refresh: a `{type:'report'}` push (a real on-disk config change)
 *     is handed to `onMessage`, which the app-state layer turns into a refetch —
 *     Broadcast identity being TRUE, not decorative.
 *
 * Reconnect is automatic with exponential backoff (pure, exported `computeBackoff`
 * so it is unit-testable). All timers/socket construction are injectable so the
 * state machine can be driven with fake timers. `close()` stops reconnection and
 * tears the socket down — no leaked sockets, no zombie timers.
 */

import type { WsMessage } from '../api/types.js';

export type WsState = 'connecting' | 'connected' | 'offline';

/**
 * Backoff for reconnect attempt `n` (0-based): `base * 2^n`, capped at `max`.
 * Deterministic (no jitter) so the reconnect ladder is testable; on loopback a
 * thundering-herd is a non-issue (single client).
 */
export function computeBackoff(attempt: number, base = 500, max = 10_000): number {
  const raw = base * 2 ** attempt;
  return Math.min(raw, max);
}

/** Minimal structural view of a WebSocket — all we use, so fakes are trivial. */
export interface WsLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}

export type WsFactory = (url: string, protocols: string[]) => WsLike;

export interface WsClientOptions {
  url: string;
  token: string;
  /** Delivered a validated report/live-session push. */
  onMessage: (msg: WsMessage) => void;
  /** Called on every connection-state transition (drives the LIVE dot). */
  onState: (state: WsState) => void;
  /** Injectable socket factory (tests). Defaults to the global WebSocket. */
  factory?: WsFactory;
  /** Injectable timers (tests). Default to the globals. */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
  /** Backoff override (tests). */
  backoff?: (attempt: number) => number;
}

/** Type-guard for the two push shapes; anything else (adversarial) is ignored. */
function isWsMessage(value: unknown): value is WsMessage {
  if (value === null || typeof value !== 'object') return false;
  const v = value as { type?: unknown; instance?: unknown; changed?: unknown; sessionId?: unknown };
  if (v.type === 'report') {
    return typeof v.instance === 'string' && Array.isArray(v.changed);
  }
  if (v.type === 'live-session') {
    return typeof v.instance === 'string' && typeof v.sessionId === 'string';
  }
  return false;
}

const defaultFactory: WsFactory = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as WsLike;

export class WsClient {
  readonly #opts: Required<
    Omit<WsClientOptions, 'factory' | 'setTimer' | 'clearTimer' | 'backoff'>
  > &
    Pick<WsClientOptions, never>;
  readonly #factory: WsFactory;
  readonly #setTimer: (fn: () => void, ms: number) => number;
  readonly #clearTimer: (id: number) => void;
  readonly #backoff: (attempt: number) => number;

  #socket: WsLike | undefined;
  #timer: number | undefined;
  #attempt = 0;
  #stopped = false;
  #state: WsState = 'offline';

  constructor(opts: WsClientOptions) {
    this.#opts = {
      url: opts.url,
      token: opts.token,
      onMessage: opts.onMessage,
      onState: opts.onState,
    };
    this.#factory = opts.factory ?? defaultFactory;
    this.#setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.#clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
    this.#backoff = opts.backoff ?? ((n) => computeBackoff(n));
  }

  get state(): WsState {
    return this.#state;
  }

  /** Open the connection (idempotent while already live/connecting). */
  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  /** Stop reconnecting and tear the socket down. Safe to call repeatedly. */
  close(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) {
      this.#clearTimer(this.#timer);
      this.#timer = undefined;
    }
    this.#teardownSocket();
    this.#setState('offline');
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#setState('connecting');
    let socket: WsLike;
    try {
      socket = this.#factory(this.#opts.url, [this.#opts.token]);
    } catch {
      // Construction itself can throw (e.g. bad URL) — treat as a dropped conn.
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.onopen = () => {
      this.#attempt = 0;
      this.#setState('connected');
    };
    socket.onmessage = (ev) => this.#handleMessage(ev.data);
    socket.onclose = () => this.#onDrop();
    socket.onerror = () => this.#onDrop();
  }

  #handleMessage(data: unknown): void {
    if (typeof data !== 'string') return; // we only ever receive text frames
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // malformed / hostile frame — ignore
    }
    if (isWsMessage(parsed)) this.#opts.onMessage(parsed);
  }

  #onDrop(): void {
    if (this.#stopped) return;
    this.#teardownSocket();
    this.#setState('offline');
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#timer !== undefined) return;
    const delay = this.#backoff(this.#attempt);
    this.#attempt += 1;
    this.#timer = this.#setTimer(() => {
      this.#timer = undefined;
      this.#connect();
    }, delay);
  }

  #teardownSocket(): void {
    const socket = this.#socket;
    if (!socket) return;
    // Detach handlers first so the close() below cannot re-enter #onDrop.
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // already gone
    }
    this.#socket = undefined;
  }

  #setState(state: WsState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#opts.onState(state);
  }
}
