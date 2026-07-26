import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, computeBackoff, type WsLike, type WsState } from './client.js';

describe('computeBackoff', () => {
  it('doubles each attempt from the base', () => {
    expect(computeBackoff(0)).toBe(500);
    expect(computeBackoff(1)).toBe(1000);
    expect(computeBackoff(2)).toBe(2000);
    expect(computeBackoff(3)).toBe(4000);
  });

  it('caps at the max', () => {
    expect(computeBackoff(20)).toBe(10_000);
  });

  it('honors overridden base/max', () => {
    expect(computeBackoff(0, 100, 300)).toBe(100);
    expect(computeBackoff(2, 100, 300)).toBe(300);
  });
});

/** A controllable fake socket implementing the WsLike surface. */
class FakeSocket implements WsLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  close(): void {
    this.closed = true;
  }
}

describe('WsClient state machine', () => {
  let sockets: FakeSocket[];
  let states: WsState[];
  let messages: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    states = [];
    messages = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeClient() {
    return new WsClient({
      url: 'ws://127.0.0.1:1/api/ws',
      token: 'tok',
      onMessage: (m) => messages.push(m),
      onState: (s) => states.push(s),
      factory: (url, protocols) => {
        const s = new FakeSocket(url, protocols);
        sockets.push(s);
        return s;
      },
    });
  }

  it('passes the token as the sole subprotocol', () => {
    const c = makeClient();
    c.start();
    expect(sockets[0]?.protocols).toEqual(['tok']);
    c.close();
  });

  it('transitions connecting → connected on open', () => {
    const c = makeClient();
    c.start();
    expect(states).toEqual(['connecting']);
    sockets[0]?.onopen?.();
    expect(states).toEqual(['connecting', 'connected']);
    expect(c.state).toBe('connected');
    c.close();
  });

  it('delivers valid report and live-session pushes; ignores junk', () => {
    const c = makeClient();
    c.start();
    sockets[0]?.onopen?.();
    const s = sockets[0] as FakeSocket;
    s.onmessage?.({ data: JSON.stringify({ type: 'report', instance: 'i', changed: ['x'] }) });
    s.onmessage?.({
      data: JSON.stringify({ type: 'live-session', instance: 'i', sessionId: 's' }),
    });
    s.onmessage?.({ data: JSON.stringify({ type: 'nope' }) }); // unknown → ignored
    s.onmessage?.({ data: 'not json{' }); // malformed → ignored
    s.onmessage?.({ data: 42 }); // non-string → ignored
    expect(messages).toEqual([
      { type: 'report', instance: 'i', changed: ['x'] },
      { type: 'live-session', instance: 'i', sessionId: 's' },
    ]);
    c.close();
  });

  it('goes offline and reconnects with growing backoff', () => {
    const c = makeClient();
    c.start();
    sockets[0]?.onopen?.();
    // Drop after a successful open → backoff(0) = 500ms.
    sockets[0]?.onclose?.();
    expect(c.state).toBe('offline');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // reconnected

    // socket[1] drops before opening → backoff(1) = 1000ms.
    sockets[1]?.onclose?.();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    c.close();
  });

  it('resets backoff after a successful reconnect', () => {
    const c = makeClient();
    c.start();
    sockets[0]?.onopen?.();
    sockets[0]?.onclose?.();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    sockets[1]?.onopen?.(); // success resets attempt
    sockets[1]?.onclose?.();
    vi.advanceTimersByTime(500); // backoff(0) again, not 1000
    expect(sockets).toHaveLength(3);
    c.close();
  });

  it('treats onerror as a drop', () => {
    const c = makeClient();
    c.start();
    sockets[0]?.onopen?.();
    sockets[0]?.onerror?.();
    expect(c.state).toBe('offline');
    c.close();
  });

  it('close() stops reconnection and tears down the socket', () => {
    const c = makeClient();
    c.start();
    sockets[0]?.onopen?.();
    sockets[0]?.onclose?.(); // schedules a reconnect
    c.close();
    expect(sockets[0]?.closed).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1); // no reconnect after close
    expect(c.state).toBe('offline');
  });
});
