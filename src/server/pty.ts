/**
 * Embedded terminal — PTY over an authenticated WebSocket (SPEC §5 row 11,
 * bead agentconfig-ngs.2). THIS IS THE HIGHEST-PRIVILEGE SURFACE IN THE APP: a
 * PTY is an arbitrary interactive shell, so a malicious web page that could open
 * one would have arbitrary code execution on the user's machine. The ENTIRE
 * defense is the WebSocket handshake auth — which is why this module reuses the
 * EXACT same {@link authorizeUpgrade} gate as the report WS (src/server/ws.ts):
 * Host allowlist + Origin allowlist (MANDATORY — a WS handshake bypasses CORS +
 * the Same-Origin Policy) + constant-time bearer token (carried in the
 * `Sec-WebSocket-Protocol` subprotocol), ALL enforced BEFORE the 101 protocol
 * switch and BEFORE any PTY is ever spawned. A failed gate rejects the upgrade
 * with a plain HTTP error — no handshake, no bytes, and (critically) no PTY.
 *
 * THE SECURITY MODEL — every point is load-bearing:
 *
 *  1. OPTIONAL NATIVE MODULE. `node-pty` is an OPTIONAL dependency, loaded
 *     LAZILY via a computed dynamic import in try/catch ({@link defaultPtyLoader})
 *     — NEVER a static top-level import. When it is absent / failed to build,
 *     the loader returns null, the terminal reports `{ available:false }`, and
 *     the rest of the server keeps working (docs/EXECUTION.md hard rule: the
 *     core npx path must never require a native module). The loader is injectable
 *     so tests pin both the present and absent paths with no real native build.
 *
 *  2. INTERACTIVE-ONLY, NEVER DAEMON. The PTY exists ONLY when the server was
 *     launched INTERACTIVELY (the `agentconfiging` launch command). Daemon mode
 *     constructs the manager with `interactive:false`, and then the /api/pty
 *     upgrade route is not served (a 404, exactly as an unknown WS path) and
 *     GET /api/pty/status reports unavailable. A daemon has NO terminal.
 *
 *  3. CWD SCOPE + VALIDATED SPAWN. A session spawns with cwd pinned to the
 *     resolved instance's realpath'd root (only an ALREADY-REGISTERED instance,
 *     never an attacker-chosen path). The command is a VALIDATED CHOICE — the
 *     user's own `$SHELL`, or a detected runtime's CLI binary from the fixed
 *     {@link RUNTIME_CLI} allowlist — spawned with a fixed arg array, NEVER a
 *     raw client-supplied command string. The user types commands INTO the
 *     shell; the initial spawn target is never client-controlled.
 *
 *  4. NO TOKEN IN THE CHILD ENV. The child env is the user's own environment
 *     with any value equal to the server's session token scrubbed out
 *     (defense-in-depth — the token is generated in-process and never placed in
 *     the environment, but we strip it anyway so a shell subprocess can never
 *     read it).
 *
 *  5. RESOURCE / DoS BOUNDS. Concurrent PTYs are capped globally; every session
 *     is killed when its WS closes (no orphaned shells), when it exits, and on
 *     server teardown ({@link PtyManager.killAll}). Inbound bytes are capped and
 *     the resize control message is bounds-validated (insane dims are ignored,
 *     never forwarded to the PTY).
 *
 *  6. PASS-THROUGH DATA PIPE. The server never interprets PTY output — it wraps
 *     raw output bytes in `{type:'output'}` text frames; the client wraps
 *     keystrokes in `{type:'input'}` frames and resizes in `{type:'resize'}`.
 *     The bytes are the user driving their own shell.
 */

import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { InstanceRegistry, RegistryInstance } from './registry.js';
import {
  authorizeUpgrade,
  decodeFrames,
  encodeCloseFrame,
  encodeTextFrame,
  type WsGateConfig,
} from './ws.js';

// ── The optional native module, typed to the minimal surface we use ───────────

/** node-pty spawn options (the subset we set). */
export interface PtySpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  name: string;
}

/** The subset of node-pty's `IPty` this module calls. */
export interface PtyProcess {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (info: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/** `spawn(file, args, opts)` — node-pty's spawn factory. */
export interface PtySpawner {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyProcess;
}

/**
 * Loads the optional `node-pty` spawner, or null when it cannot be loaded (not
 * installed / native build failed). Injectable for tests.
 */
export type PtyLoader = () => Promise<PtySpawner | null>;

/**
 * The production loader: a lazy, guarded dynamic import. A COMPUTED specifier +
 * `@vite-ignore` keeps the bundler / test-runner from statically resolving the
 * optional module; a rejected import (module absent) is caught → null.
 */
export const defaultPtyLoader: PtyLoader = async () => {
  try {
    const spec = ['node', 'pty'].join('-');
    const mod = (await import(/* @vite-ignore */ spec)) as {
      spawn?: PtySpawner['spawn'];
    };
    if (typeof mod.spawn !== 'function') return null;
    const spawn = mod.spawn.bind(mod);
    return { spawn: (file, args, opts) => spawn(file, args, opts) };
  } catch {
    return null;
  }
};

// ── Reasons + bounds ──────────────────────────────────────────────────────────

/** Served when the server was not launched interactively (daemon / report mode). */
export const REASON_NOT_INTERACTIVE =
  'the terminal is available only when agentconfig is launched interactively';
/** Served when the optional native module cannot be loaded. */
export const REASON_NO_MODULE =
  'the terminal requires the optional node-pty module (not installed)';

/** Default global cap on concurrent PTYs — a sane bound, not a real-world limit. */
export const DEFAULT_MAX_SESSIONS = 8;
/** Terminal geometry bounds — a resize outside this is ignored (never forwarded). */
export const MIN_COLS = 1;
export const MAX_COLS = 1000;
export const MIN_ROWS = 1;
export const MAX_ROWS = 1000;
/** Default geometry for a fresh PTY (the client fits + resizes on attach). */
export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
/** Hard cap on buffered inbound bytes; a client that floods us is dropped. */
const MAX_INBOUND_BYTES = 1024 * 1024;

/**
 * FIXED allowlist: detected-runtime kind → interactive CLI binary. This is the
 * ONLY set of non-shell commands a PTY may launch, and only when the runtime is
 * actually detected in the instance. Editors / IDE-extension runtimes (cursor,
 * copilot, continue) are deliberately absent — they have no interactive CLI.
 */
export const RUNTIME_CLI: Readonly<Record<string, string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  'gemini-cli': 'gemini',
  aider: 'aider',
  opencode: 'opencode',
};

// ── Shell / CLI choices ───────────────────────────────────────────────────────

/** One selectable launch target offered to the client (never a raw command). */
export interface ShellChoice {
  /** Opaque id: `shell` (the user's $SHELL) or `cli:<kind>` (a detected CLI). */
  id: string;
  /** Human label (the binary basename / runtime CLI name). */
  label: string;
}

/** The user's own shell, or a safe default. Never client-controlled. */
export function defaultShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return env['COMSPEC'] ?? 'cmd.exe';
  return env['SHELL'] ?? '/bin/bash';
}

/**
 * The launch choices for an instance: always the plain shell, plus a CLI entry
 * for each DETECTED runtime that has an allowlisted interactive binary.
 */
export function shellChoices(
  detectedKinds: Iterable<string>,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): ShellChoice[] {
  const choices: ShellChoice[] = [
    { id: 'shell', label: path.basename(defaultShell(env, platform)) || 'shell' },
  ];
  const seen = new Set<string>();
  for (const kind of detectedKinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    const bin = RUNTIME_CLI[kind];
    if (bin) choices.push({ id: `cli:${kind}`, label: bin });
  }
  return choices;
}

/**
 * Resolve a client-supplied choice id to a fixed { command, args } — or
 * undefined when it is not a valid choice for this instance. A `cli:<kind>`
 * resolves ONLY when the kind is both detected AND allowlisted, so a fabricated
 * id can never spawn an arbitrary binary. Never returns a client string.
 */
export function resolveChoice(
  id: string,
  detectedKinds: Set<string>,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): { command: string; args: string[] } | undefined {
  if (id === 'shell') return { command: defaultShell(env, platform), args: [] };
  if (id.startsWith('cli:')) {
    const kind = id.slice('cli:'.length);
    if (!detectedKinds.has(kind)) return undefined;
    const bin = RUNTIME_CLI[kind];
    return bin ? { command: bin, args: [] } : undefined;
  }
  return undefined;
}

/** Build the child env from the user's env, scrubbing the session token. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  sessionToken: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    // Never let the server's session token reach a spawned shell.
    if (sessionToken !== undefined && sessionToken !== '' && value === sessionToken) continue;
    out[key] = value;
  }
  return out;
}

// ── The client/server control protocol (pure, mirrored in web logic.ts) ───────

/** A parsed, validated client→server message. */
export type PtyClientMessage =
  { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

/**
 * Parse + validate one client→server text frame. Returns undefined for any
 * malformed / hostile shape — a bad frame is ignored, never forwarded to the
 * PTY. A resize with non-integer or out-of-bounds dims is rejected here, so an
 * insane geometry can never reach `pty.resize`.
 */
export function parseClientMessage(raw: string): PtyClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  const msg = value as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
  if (msg.type === 'input') {
    return typeof msg.data === 'string' ? { type: 'input', data: msg.data } : undefined;
  }
  if (msg.type === 'resize') {
    const { cols, rows } = msg;
    if (
      typeof cols === 'number' &&
      typeof rows === 'number' &&
      Number.isInteger(cols) &&
      Number.isInteger(rows) &&
      cols >= MIN_COLS &&
      cols <= MAX_COLS &&
      rows >= MIN_ROWS &&
      rows <= MAX_ROWS
    ) {
      return { type: 'resize', cols, rows };
    }
    return undefined;
  }
  return undefined;
}

// ── The raw WS connection carrying the PTY data pipe ──────────────────────────

/** RFC 6455 opcodes (mirrors ws.ts — this connection interprets inbound frames). */
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const CLOSE_NORMAL = 1000;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_TOO_BIG = 1009;

interface DecodedFrame {
  fin: boolean;
  rsv: number;
  masked: boolean;
  opcode: number;
  payload: Buffer;
}

/** RFC 6455 validation of a client→server frame (mirrors ws.ts `frameIsInvalid`). */
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
 * One upgraded PTY WebSocket connection. Unlike the report WsConnection (which
 * only PUSHES and ignores inbound data frames), this connection INTERPRETS
 * inbound text/binary frames as the client's terminal input/resize protocol and
 * hands them to `onMessage`. It still fails-closed on any RFC 6455 violation and
 * caps inbound bytes.
 */
export class PtyConnection {
  readonly #socket: Duplex;
  #buf: Buffer = Buffer.alloc(0);
  #closed = false;
  #notified = false;
  /** Delivered each validated inbound text/binary payload (a client message). */
  onMessage?: (text: string) => void;
  /** Fired exactly once when the socket is gone (the session kills its PTY here). */
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
      this.close(CLOSE_TOO_BIG);
      return;
    }
    const { frames, rest } = decodeFrames(this.#buf) as { frames: DecodedFrame[]; rest: Buffer };
    this.#buf = rest;
    for (const frame of frames) {
      if (frameIsInvalid(frame)) {
        this.close(CLOSE_PROTOCOL_ERROR);
        return;
      }
      if (frame.opcode === OP_CLOSE) {
        this.close(CLOSE_NORMAL);
        return;
      }
      if (frame.opcode === OP_PING) {
        this.#write(encodePong(frame.payload));
        continue;
      }
      if (frame.opcode === OP_TEXT || frame.opcode === OP_BINARY) {
        this.onMessage?.(frame.payload.toString('utf8'));
      }
      // OP_PONG: accepted, ignored.
    }
  }

  /** Push a text message (a `{type:'output'|'exit'|'error'}` frame). */
  send(text: string): void {
    if (this.#closed) return;
    this.#write(encodeTextFrame(text));
  }

  #write(buf: Buffer): void {
    if (this.#closed) return;
    try {
      const ok = this.#socket.write(buf);
      if (ok === false && this.#socket.writableLength > MAX_INBOUND_BYTES) {
        this.close(CLOSE_TOO_BIG);
      }
    } catch {
      this.#markClosed();
    }
  }

  /** Send a close frame and tear the socket down (idempotent; fires onClose). */
  close(code: number = CLOSE_NORMAL): void {
    if (this.#closed) {
      this.#markClosed();
      return;
    }
    this.#closed = true;
    try {
      this.#socket.write(encodeCloseFrame(code));
    } catch {
      // already gone
    }
    try {
      this.#socket.destroy();
    } catch {
      // ignore
    }
    this.#markClosed();
  }

  get closed(): boolean {
    return this.#closed;
  }

  #markClosed(): void {
    this.#closed = true;
    if (this.#notified) return;
    this.#notified = true;
    this.onClose?.();
  }
}

/** Encode a pong frame echoing the ping payload (≤125 bytes, enforced above). */
function encodePong(payload: Buffer): Buffer {
  const b0 = 0x80 | (OP_PONG & 0x0f);
  return Buffer.concat([Buffer.from([b0, payload.length]), payload]);
}

// ── The PTY manager (spawn, track, cap, teardown) ─────────────────────────────

/** One live PTY session tracked by the manager. */
interface InternalSession {
  process: PtyProcess;
  connection: PtyConnection;
  killed: boolean;
}

export interface PtyManagerConfig {
  /** True only for an interactive launch; daemon mode passes false. */
  interactive: boolean;
  /** Optional loader for the native module. Defaults to {@link defaultPtyLoader}. */
  loader?: PtyLoader;
  /** Base env for spawned shells. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Runtime platform. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** The server session token — scrubbed from every child env. */
  sessionToken?: string;
  /** Global cap on concurrent PTYs. Defaults to {@link DEFAULT_MAX_SESSIONS}. */
  maxSessions?: number;
}

/**
 * Owns the lifecycle of every PTY: lazily loads node-pty, spawns cwd-scoped
 * sessions with a validated command + scrubbed env, caps concurrency, and kills
 * every session on WS close, exit, and server teardown. Never throws for a
 * missing native module — the loader degrades to null.
 */
export class PtyManager {
  readonly interactive: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly #loader: PtyLoader;
  readonly #sessionToken: string | undefined;
  readonly #maxSessions: number;
  readonly #sessions = new Set<InternalSession>();

  constructor(config: PtyManagerConfig) {
    this.interactive = config.interactive;
    this.env = config.env ?? process.env;
    this.platform = config.platform ?? process.platform;
    this.#loader = config.loader ?? defaultPtyLoader;
    this.#sessionToken = config.sessionToken;
    this.#maxSessions = config.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  /** Load the native spawner, or null when node-pty is unavailable. */
  async loadSpawner(): Promise<PtySpawner | null> {
    try {
      return await this.#loader();
    } catch {
      return null;
    }
  }

  get size(): number {
    return this.#sessions.size;
  }

  get maxSessions(): number {
    return this.#maxSessions;
  }

  isFull(): boolean {
    return this.#sessions.size >= this.#maxSessions;
  }

  /**
   * Spawn a PTY for a connection and wire the full bidirectional pipe: PTY
   * output → client frames, client input/resize → PTY, and kill-on-close both
   * ways. The command MUST be a validated choice (see {@link resolveChoice}) and
   * cwd MUST be the resolved instance root — callers enforce that before here.
   */
  spawn(
    spawner: PtySpawner,
    connection: PtyConnection,
    opts: { cwd: string; command: string; args: string[] },
  ): void {
    const proc = spawner.spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: buildChildEnv(this.env, this.#sessionToken),
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      name: 'xterm-256color',
    });
    const session: InternalSession = { process: proc, connection, killed: false };
    this.#sessions.add(session);

    proc.onData((data) => {
      // Raw PTY output — never interpreted, only wrapped + forwarded.
      connection.send(JSON.stringify({ type: 'output', data }));
    });
    proc.onExit((info) => {
      connection.send(JSON.stringify({ type: 'exit', code: info.exitCode }));
      this.#kill(session);
      connection.close();
    });
    connection.onMessage = (text) => {
      const msg = parseClientMessage(text);
      if (!msg) return; // malformed / hostile → ignored
      if (msg.type === 'input') {
        proc.write(msg.data);
      } else {
        proc.resize(msg.cols, msg.rows);
      }
    };
    connection.onClose = () => this.#kill(session);
  }

  #kill(session: InternalSession): void {
    if (session.killed) return;
    session.killed = true;
    try {
      session.process.kill();
    } catch {
      // already gone
    }
    this.#sessions.delete(session);
  }

  /** Kill every live PTY (server teardown). No orphaned shells survive. */
  killAll(): void {
    for (const session of [...this.#sessions]) this.#kill(session);
    this.#sessions.clear();
  }
}

// ── The authenticated upgrade handler ─────────────────────────────────────────

type RejectStatus = 400 | 401 | 403 | 404 | 426 | 503;

const REJECT_TEXT: Record<RejectStatus, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  426: 'Upgrade Required',
  503: 'Service Unavailable',
};

/** Reject an upgrade with a plain HTTP error — no protocol switch, no PTY. */
function rejectUpgrade(socket: Duplex, status: RejectStatus): void {
  const extra = status === 426 ? 'Sec-WebSocket-Version: 13\r\n' : '';
  try {
    socket.write(
      `HTTP/1.1 ${status} ${REJECT_TEXT[status]}\r\n${extra}Connection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  } catch {
    // already gone
  }
  try {
    socket.destroy();
  } catch {
    // ignore
  }
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

export interface PtyUpgradeConfig extends WsGateConfig {
  /** The shared PTY manager (caps + teardown live here). */
  manager: PtyManager;
  /** Resolves `?instance=` to the cwd scope (already-registered instances only). */
  registry: InstanceRegistry;
  /** Path the PTY WS lives at. Default /api/pty. */
  path?: string;
}

/** Detected runtime kinds for an instance (from its cached report). Never throws. */
function detectedKinds(registry: InstanceRegistry, instance: RegistryInstance): Set<string> {
  try {
    return new Set(registry.report(instance).agents.map((a) => a.kind));
  } catch {
    return new Set();
  }
}

/**
 * Handle a node http 'upgrade' for the PTY WS. THE AUTH IS IDENTICAL to the
 * report WS: {@link authorizeUpgrade} enforces Host + Origin + token BEFORE the
 * 101, and ONLY THEN — after also validating interactive mode, native-module
 * availability, the resolved instance, the shell choice, and the concurrency cap
 * — is a PTY spawned. A failure at ANY gate rejects with a plain HTTP error and
 * NO pty is spawned. Never throws.
 */
export async function handlePtyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: PtyUpgradeConfig,
): Promise<void> {
  socket.on('error', () => {
    /* swallow — connection is being torn down */
  });

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== (config.path ?? '/api/pty')) {
    rejectUpgrade(socket, 404);
    return;
  }

  // INTERACTIVE-ONLY: a daemon-mode server has no terminal. Rejected as a 404 —
  // indistinguishable from the route not existing, and BEFORE any auth probe.
  if (!config.manager.interactive) {
    rejectUpgrade(socket, 404);
    return;
  }

  // THE GATE — identical to the report WS (Host, Origin, version, token).
  const decision = authorizeUpgrade(req, config);
  if (!decision.ok) {
    rejectUpgrade(socket, decision.status);
    return;
  }

  // Global concurrency cap (503). Checked AFTER auth so an unauthenticated
  // caller learns nothing about capacity.
  if (config.manager.isFull()) {
    rejectUpgrade(socket, 503);
    return;
  }

  // node-pty must be loadable, else there is nothing to spawn.
  const spawner = await config.manager.loadSpawner();
  if (!spawner) {
    rejectUpgrade(socket, 503);
    return;
  }

  // Resolve the instance (already-registered only) → the cwd scope.
  const instance = config.registry.resolve(url.searchParams.get('instance') ?? undefined);
  if (!instance) {
    rejectUpgrade(socket, 404);
    return;
  }

  // Validate the shell/CLI choice against the instance's allowed set. A bad or
  // fabricated choice is a 400 — NO pty spawned.
  const choiceId = url.searchParams.get('shell') ?? 'shell';
  const resolved = resolveChoice(
    choiceId,
    detectedKinds(config.registry, instance),
    config.manager.env,
    config.manager.platform,
  );
  if (!resolved) {
    rejectUpgrade(socket, 400);
    return;
  }

  // Every gate passed — complete the handshake and spawn the cwd-scoped PTY.
  socket.write(handshakeResponse(decision.acceptKey, decision.subprotocol));
  const connection = new PtyConnection(socket, head);
  try {
    config.manager.spawn(spawner, connection, {
      cwd: instance.root,
      command: resolved.command,
      args: resolved.args,
    });
  } catch (err) {
    // A spawn failure (e.g. the CLI binary is not on PATH) is reported to the
    // client as an error frame, then the connection closes — never a crash.
    connection.send(
      JSON.stringify({ type: 'error', message: `failed to start ${resolved.command}` }),
    );
    connection.close();
    console.error(`agentconfiging server: pty spawn failed: ${String(err)}`);
  }
}
