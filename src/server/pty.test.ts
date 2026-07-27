/**
 * Embedded-terminal PTY tests (bead agentconfig-ngs.2). This is the highest-
 * privilege surface in the app, so the WS-handshake AUTH is the star of the
 * suite: a PTY upgrade with a bad Origin / bad Host / missing token / wrong
 * token is REJECTED before the 101 and NO pty is spawned (an injected fake
 * spawner records every spawn — we assert ZERO on a failed gate). We also pin the
 * optional-native-module model (an injected null loader → unavailable, no crash),
 * the interactive-only gate (a daemon-mode manager serves no upgrade), cwd = the
 * instance root on spawn, the validated shell/CLI choice (never a client string),
 * the scrubbed child env (the session token never leaks), resize-message bounds
 * validation, the concurrency cap, and kill-on-close + kill-on-teardown (no
 * orphaned shells).
 */

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  PtyConnection,
  PtyManager,
  buildChildEnv,
  defaultShell,
  handlePtyUpgrade,
  parseClientMessage,
  resolveChoice,
  shellChoices,
  type PtyProcess,
  type PtySpawner,
} from './pty.js';
import { decodeFrames } from './ws.js';
import { InstanceRegistry } from './registry.js';
import type { ReportStore } from './store.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** In-memory Duplex stand-in that records writes (mirrors ws.test.ts). */
class FakeSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  writableLength = 0;
  writeReturn = true;
  write(chunk: Buffer | string): boolean {
    this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return this.writeReturn;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
  asDuplex(): Duplex {
    return this as unknown as Duplex;
  }
  text(): string {
    return Buffer.concat(this.written).toString('utf8');
  }
}

/** A fake node-pty process with a full call log; drives onData/onExit manually. */
class FakePty implements PtyProcess {
  readonly pid = 4242;
  writes: string[] = [];
  resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  #dataCb?: (d: string) => void;
  #exitCb?: (i: { exitCode: number }) => void;
  onData(cb: (d: string) => void): void {
    this.#dataCb = cb;
  }
  onExit(cb: (i: { exitCode: number }) => void): void {
    this.#exitCb = cb;
  }
  write(data: string): void {
    this.writes.push(data);
  }
  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }
  kill(): void {
    this.killed = true;
  }
  emitData(d: string): void {
    this.#dataCb?.(d);
  }
  emitExit(code: number): void {
    this.#exitCb?.({ exitCode: code });
  }
}

interface SpawnCall {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

/** A recording spawner: every spawn is logged so gates can assert ZERO spawns. */
function recordingSpawner(): { spawner: PtySpawner; calls: SpawnCall[]; ptys: FakePty[] } {
  const calls: SpawnCall[] = [];
  const ptys: FakePty[] = [];
  const spawner: PtySpawner = {
    spawn(file, args, opts) {
      calls.push({ file, args: [...args], cwd: opts.cwd, env: opts.env });
      const pty = new FakePty();
      ptys.push(pty);
      return pty;
    },
  };
  return { spawner, calls, ptys };
}

// ── A registry with a fake store exposing chosen detected agents ──────────────

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-pty-'));
const projectRoot = fs.realpathSync(base);
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

function registryWith(kinds: string[]): { registry: InstanceRegistry; id: string } {
  const registry = new InstanceRegistry('1.0.0', (root) => {
    const fake = {
      get: () => ({ root, scope: 'project', agents: kinds.map((kind) => ({ kind })) }) as unknown,
      invalidate: () => undefined,
    };
    return fake as unknown as ReportStore;
  });
  const inst = registry.seed(projectRoot, { makeDefault: true });
  return { registry, id: inst.id };
}

// ── WS-handshake fixtures (identical to ws.test.ts — same auth is the point) ──

const PORT = 9911;
const TOKEN = 'pty-session-token-pty-session-token-pty-1';
const tokenHash = createHash('sha256').update(TOKEN).digest();

function ptyReq(headers: Record<string, string>, url = '/api/pty'): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage;
}
const validHeaders = () => ({
  host: `127.0.0.1:${PORT}`,
  origin: `http://127.0.0.1:${PORT}`,
  'sec-websocket-version': '13',
  'sec-websocket-protocol': TOKEN,
  'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
});

function makeManager(
  spawner: PtySpawner | null,
  opts: { interactive?: boolean; env?: NodeJS.ProcessEnv; maxSessions?: number } = {},
): PtyManager {
  return new PtyManager({
    interactive: opts.interactive ?? true,
    loader: () => Promise.resolve(spawner),
    env: opts.env ?? { SHELL: '/bin/bash' },
    platform: 'linux',
    ...(opts.maxSessions !== undefined ? { maxSessions: opts.maxSessions } : {}),
  });
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('parseClientMessage (control protocol — validated, bounds-checked)', () => {
  it('accepts a well-formed input message', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'input', data: 'ls\n' }))).toEqual({
      type: 'input',
      data: 'ls\n',
    });
  });

  it('accepts a resize within bounds', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    });
  });

  it('rejects an insane / non-integer / out-of-range resize (never forwarded)', () => {
    for (const bad of [
      { type: 'resize', cols: 0, rows: 24 },
      { type: 'resize', cols: 80, rows: 0 },
      { type: 'resize', cols: 1e9, rows: 24 },
      { type: 'resize', cols: 80.5, rows: 24 },
      { type: 'resize', cols: -1, rows: 24 },
      { type: 'resize', cols: 'x', rows: 24 },
    ]) {
      expect(parseClientMessage(JSON.stringify(bad))).toBeUndefined();
    }
  });

  it('rejects malformed / hostile / unknown shapes', () => {
    expect(parseClientMessage('not json')).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'exec', data: 'rm' }))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify({ type: 'input', data: 5 }))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify(null))).toBeUndefined();
    expect(parseClientMessage(JSON.stringify(['input']))).toBeUndefined();
  });
});

describe('shellChoices + resolveChoice (validated launch targets, never raw commands)', () => {
  const env = { SHELL: '/usr/bin/zsh' } as NodeJS.ProcessEnv;

  it('always offers the plain shell, plus a CLI per detected + allowlisted runtime', () => {
    const choices = shellChoices(['claude-code', 'codex', 'cursor'], env, 'linux');
    expect(choices[0]).toEqual({ id: 'shell', label: 'zsh' });
    // cursor is NOT allowlisted (an editor, no interactive CLI) → not offered.
    expect(choices.map((c) => c.id)).toEqual(['shell', 'cli:claude-code', 'cli:codex']);
    expect(choices.find((c) => c.id === 'cli:claude-code')?.label).toBe('claude');
  });

  it('resolves the plain shell to $SHELL with no args', () => {
    expect(resolveChoice('shell', new Set(), env, 'linux')).toEqual({
      command: '/usr/bin/zsh',
      args: [],
    });
  });

  it('resolves a detected CLI to its FIXED binary (no client string)', () => {
    expect(resolveChoice('cli:claude-code', new Set(['claude-code']), env, 'linux')).toEqual({
      command: 'claude',
      args: [],
    });
  });

  it('refuses a CLI that is not detected in the instance', () => {
    expect(resolveChoice('cli:claude-code', new Set(['codex']), env, 'linux')).toBeUndefined();
  });

  it('refuses an unknown / fabricated / non-allowlisted choice id', () => {
    expect(resolveChoice('cli:cursor', new Set(['cursor']), env, 'linux')).toBeUndefined();
    expect(resolveChoice('rm -rf /', new Set(), env, 'linux')).toBeUndefined();
    expect(resolveChoice('cli:../../bin/sh', new Set(), env, 'linux')).toBeUndefined();
    expect(resolveChoice('', new Set(), env, 'linux')).toBeUndefined();
  });

  it('defaultShell falls back safely and honors COMSPEC on win32', () => {
    expect(defaultShell({}, 'linux')).toBe('/bin/bash');
    expect(defaultShell({ COMSPEC: 'C:\\cmd.exe' } as NodeJS.ProcessEnv, 'win32')).toBe(
      'C:\\cmd.exe',
    );
  });
});

describe('buildChildEnv (the session token never leaks into the shell)', () => {
  it('copies the env but scrubs any value equal to the session token', () => {
    const env = { PATH: '/usr/bin', SECRET: TOKEN, HOME: '/home/u' } as NodeJS.ProcessEnv;
    const out = buildChildEnv(env, TOKEN);
    expect(out['PATH']).toBe('/usr/bin');
    expect(out['HOME']).toBe('/home/u');
    expect(out['SECRET']).toBeUndefined();
    expect(Object.values(out)).not.toContain(TOKEN);
  });
});

// ── The upgrade AUTH gate — the whole defense ────────────────────────────────

describe('handlePtyUpgrade AUTH gate (a failed gate spawns NO pty)', () => {
  const cfg = (
    manager: PtyManager,
    registry: InstanceRegistry,
  ): Parameters<typeof handlePtyUpgrade>[3] => ({
    tokenHash,
    port: () => PORT,
    manager,
    registry,
    path: '/api/pty',
  });

  it('completes the 101 handshake and spawns a cwd-scoped pty on a valid upgrade', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('101 Switching Protocols');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cwd).toBe(projectRoot); // cwd pinned to the instance root
    expect(calls[0]!.file).toBe('/bin/bash'); // the validated default shell
    expect(manager.size).toBe(1);
  });

  const badGates: Array<[string, Record<string, string>]> = [
    ['a foreign Origin', { ...validHeaders(), origin: 'http://evil.example' }],
    ['a missing Origin', omit(validHeaders(), 'origin')],
    ['a foreign Host', { ...validHeaders(), host: 'evil.example' }],
    ['a missing token', omit(validHeaders(), 'sec-websocket-protocol')],
    ['a wrong token', { ...validHeaders(), 'sec-websocket-protocol': 'wrong-token' }],
  ];

  for (const [label, headers] of badGates) {
    it(`rejects ${label} BEFORE the 101 and spawns NO pty`, async () => {
      const { spawner, calls } = recordingSpawner();
      const { registry } = registryWith([]);
      const manager = makeManager(spawner);
      const socket = new FakeSocket();
      await handlePtyUpgrade(
        ptyReq(headers),
        socket.asDuplex(),
        Buffer.alloc(0),
        cfg(manager, registry),
      );
      const reply = socket.text();
      expect(reply).not.toContain('101');
      expect(reply).toMatch(/^HTTP\/1\.1 (401|403) /);
      expect(calls).toHaveLength(0); // NO pty spawned
      expect(manager.size).toBe(0);
      expect(socket.destroyed).toBe(true);
    });
  }

  it('rejects a foreign upgrade PATH with 404 (no auth probe, no pty)', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders(), '/api/other'),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('404 Not Found');
    expect(calls).toHaveLength(0);
  });

  it('daemon mode (interactive:false) serves NO pty upgrade — 404, no spawn', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = makeManager(spawner, { interactive: false });
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('404 Not Found');
    expect(calls).toHaveLength(0);
  });

  it('node-pty absent (null loader) → 503, no spawn, no crash', async () => {
    const { registry } = registryWith([]);
    const manager = makeManager(null); // loader yields null
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('503 Service Unavailable');
    expect(manager.size).toBe(0);
  });

  it('an unknown instance → 404, no spawn', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders(), '/api/pty?instance=deadbeefdeadbeef'),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('404 Not Found');
    expect(calls).toHaveLength(0);
  });

  it('a bad / fabricated shell choice → 400, NO pty spawned', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith(['codex']); // codex detected, claude NOT
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders(), '/api/pty?shell=cli:claude-code'),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toMatch(/^HTTP\/1\.1 400 /);
    expect(calls).toHaveLength(0);
  });

  it('launches a DETECTED runtime CLI as a fixed-arg spawn when chosen', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith(['claude-code']);
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders(), '/api/pty?shell=cli:claude-code'),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe('claude');
    expect(calls[0]!.args).toEqual([]);
  });

  it('the spawned child env never carries the session token', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = new PtyManager({
      interactive: true,
      loader: () => Promise.resolve(spawner),
      env: { SHELL: '/bin/bash', LEAK: TOKEN, PATH: '/usr/bin' } as NodeJS.ProcessEnv,
      platform: 'linux',
      sessionToken: TOKEN,
    });
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(calls).toHaveLength(1);
    expect(Object.values(calls[0]!.env)).not.toContain(TOKEN);
    expect(calls[0]!.env['LEAK']).toBeUndefined();
    expect(calls[0]!.env['PATH']).toBe('/usr/bin');
  });

  it('enforces the global concurrency cap (503 once full, no extra spawn)', async () => {
    const { spawner, calls } = recordingSpawner();
    const { registry } = registryWith([]);
    const manager = makeManager(spawner, { maxSessions: 1 });
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      new FakeSocket().asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(manager.size).toBe(1);
    const socket = new FakeSocket();
    await handlePtyUpgrade(
      ptyReq(validHeaders()),
      socket.asDuplex(),
      Buffer.alloc(0),
      cfg(manager, registry),
    );
    expect(socket.text()).toContain('503 Service Unavailable');
    expect(calls).toHaveLength(1); // the capped upgrade did not spawn
  });
});

// ── The data pipe + lifecycle ────────────────────────────────────────────────

describe('PtyManager data pipe + lifecycle (kill on close, exit, teardown)', () => {
  function connectOne() {
    const { spawner, ptys } = recordingSpawner();
    const manager = makeManager(spawner);
    const socket = new FakeSocket();
    const connection = new PtyConnection(socket.asDuplex());
    manager.spawn(spawner, connection, { cwd: projectRoot, command: '/bin/bash', args: [] });
    return { manager, socket, connection, pty: ptys[0]! };
  }

  it('pipes PTY output to the client as an {type:output} text frame', () => {
    const { socket, pty } = connectOne();
    pty.emitData('hello\r\n');
    const frame = decodeFrames(Buffer.concat(socket.written)).frames.find((f) => f.opcode === 0x1);
    expect(frame).toBeDefined();
    expect(JSON.parse(frame!.payload.toString('utf8'))).toEqual({
      type: 'output',
      data: 'hello\r\n',
    });
  });

  it('forwards a validated client input frame to pty.write', () => {
    const { socket, pty } = connectOne();
    socket.emit('data', clientTextFrame(JSON.stringify({ type: 'input', data: 'echo hi\n' })));
    expect(pty.writes).toEqual(['echo hi\n']);
  });

  it('forwards a validated resize; ignores an out-of-bounds one', () => {
    const { socket, pty } = connectOne();
    socket.emit('data', clientTextFrame(JSON.stringify({ type: 'resize', cols: 100, rows: 30 })));
    socket.emit(
      'data',
      clientTextFrame(JSON.stringify({ type: 'resize', cols: 999999, rows: 30 })),
    );
    expect(pty.resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('kills the PTY when the WS closes (no orphaned shell)', () => {
    const { manager, connection, pty } = connectOne();
    expect(manager.size).toBe(1);
    connection.close();
    expect(pty.killed).toBe(true);
    expect(manager.size).toBe(0);
  });

  it('closes the WS + drops the session when the PTY exits', () => {
    const { manager, socket, pty } = connectOne();
    pty.emitExit(0);
    expect(manager.size).toBe(0);
    expect(socket.destroyed).toBe(true);
    const frames = decodeFrames(Buffer.concat(socket.written)).frames;
    expect(frames.some((f) => f.opcode === 0x1)).toBe(true); // the exit frame
  });

  it('killAll() kills every live PTY at teardown', () => {
    const { spawner, ptys } = recordingSpawner();
    const manager = makeManager(spawner);
    for (let i = 0; i < 3; i += 1) {
      const conn = new PtyConnection(new FakeSocket().asDuplex());
      manager.spawn(spawner, conn, { cwd: projectRoot, command: '/bin/bash', args: [] });
    }
    expect(manager.size).toBe(3);
    manager.killAll();
    expect(manager.size).toBe(0);
    expect(ptys.every((p) => p.killed)).toBe(true);
  });

  it('a hostile inbound control frame fails the connection closed (1002)', () => {
    const { manager, socket } = connectOne();
    // An UNMASKED client frame violates RFC 6455 §5.1 → fail-close.
    socket.emit('data', Buffer.from([0x81, 0x01, 0x41])); // FIN+text, len 1, unmasked
    expect(socket.destroyed).toBe(true);
    expect(manager.size).toBe(0); // the session was killed on close
  });
});

// ── A single REAL node-pty spawn (only when the native module is present) ─────

describe('real node-pty spawn (skipped when the module is absent)', () => {
  it('spawns a short-lived shell, echoes, and is killed — cwd-scoped', async () => {
    const nodePty = await import('node-pty').catch(() => null);
    if (!nodePty || typeof nodePty.spawn !== 'function') return; // absent → skip
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-pty-real-'));
    try {
      const manager = new PtyManager({ interactive: true, sessionToken: TOKEN });
      const spawner = await manager.loadSpawner();
      expect(spawner).not.toBeNull();
      const socket = new FakeSocket();
      const connection = new PtyConnection(socket.asDuplex());
      try {
        manager.spawn(spawner!, connection, {
          cwd: fs.realpathSync(dir),
          command: defaultShell(process.env, process.platform),
          args: [],
        });
      } catch {
        // A restricted/sandboxed CI cannot fork (posix_spawnp) — the loader still
        // proved the module is present; skip the live echo rather than fail.
        return;
      }
      expect(manager.size).toBe(1);
      // Drive an echo and let the PTY produce output.
      socket.emit('data', clientTextFrame(JSON.stringify({ type: 'input', data: 'echo READY\n' })));
      await vi.waitFor(
        () => {
          const got = Buffer.concat(socket.written).toString('utf8');
          expect(got).toContain('READY');
        },
        { timeout: 4000, interval: 50 },
      );
      manager.killAll();
      expect(manager.size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** A valid MASKED client→server text frame carrying `text`. */
function clientTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  let header: Buffer;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i]! ^ mask[i & 3]!;
  return Buffer.concat([header, mask, masked]);
}

/** Return a copy of `obj` without `key` (for the missing-header gate cases). */
function omit(obj: Record<string, string>, key: string): Record<string, string> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}
