/**
 * Embedded-terminal page — pure logic (bead ngs.2). DOM-free and React-free so
 * the PTY control protocol, the WS-URL builder, the xterm theme mapping, and the
 * tab bookkeeping are unit-testable in isolation; Terminal.tsx stays a thin
 * render + effect shell over xterm.js.
 *
 * The control protocol MIRRORS the server (src/server/pty.ts): the client wraps
 * keystrokes as `{type:'input'}` and geometry as `{type:'resize'}` text frames;
 * the server wraps raw PTY output as `{type:'output'}` and lifecycle as
 * `{type:'exit'|'error'}`. The server never interprets the bytes — it is the
 * user driving their own shell.
 */

import type { ShellChoice } from '../../api/types.js';

/** A server→client message (mirrors src/server/pty.ts `PtyServerMessage`). */
export type PtyServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code?: number }
  | { type: 'error'; message: string };

/** Build the authenticated PTY WebSocket URL for an instance + shell choice.
 *  The token travels as the subprotocol (not here); instance + shell are
 *  non-secret selectors, safe as query params. */
export function buildPtyWsUrl(
  loc: Pick<Location, 'protocol' | 'host'>,
  opts: { instance?: string; shell: string },
): string {
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  const params = new URLSearchParams();
  if (opts.instance !== undefined && opts.instance !== '') params.set('instance', opts.instance);
  params.set('shell', opts.shell);
  return `${scheme}://${loc.host}/api/pty?${params.toString()}`;
}

/** Encode a keystroke payload as an input control frame. */
export function encodeInput(data: string): string {
  return JSON.stringify({ type: 'input', data });
}

/** Encode a geometry as a resize control frame. */
export function encodeResize(cols: number, rows: number): string {
  return JSON.stringify({ type: 'resize', cols, rows });
}

/**
 * Parse + validate one server→client frame. Returns undefined for any malformed
 * / hostile shape (ignored by the renderer). Output data is written to xterm as
 * a byte stream — never interpreted as markup.
 */
export function parseServerMessage(raw: unknown): PtyServerMessage | undefined {
  if (typeof raw !== 'string') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;
  const msg = value as { type?: unknown; data?: unknown; code?: unknown; message?: unknown };
  if (msg.type === 'output') {
    return typeof msg.data === 'string' ? { type: 'output', data: msg.data } : undefined;
  }
  if (msg.type === 'exit') {
    return typeof msg.code === 'number' ? { type: 'exit', code: msg.code } : { type: 'exit' };
  }
  if (msg.type === 'error') {
    return typeof msg.message === 'string' ? { type: 'error', message: msg.message } : undefined;
  }
  return undefined;
}

/** An xterm ITheme-shaped palette (kept structural so no xterm import is needed). */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  brightBlack: string;
}

/**
 * Map the active Signal Grid theme to an xterm palette (DESIGN §2/§6). Pure so
 * the mapping is testable; Terminal.tsx reads the two palettes by theme name.
 */
export function xtermTheme(theme: 'paper' | 'ink'): TerminalTheme {
  if (theme === 'ink') {
    return {
      background: '#0b0e17',
      foreground: '#e8eaf2',
      cursor: '#b4ff39',
      selectionBackground: 'rgba(180, 255, 57, 0.22)',
      black: '#0b0e17',
      brightBlack: '#232a3e',
    };
  }
  return {
    background: '#ffffff',
    foreground: '#141519',
    cursor: '#2e7d32',
    selectionBackground: 'rgba(46, 125, 50, 0.25)',
    black: '#141519',
    brightBlack: '#5c5f6a',
  };
}

/** One open terminal tab (metadata only — the xterm instance lives in a ref). */
export interface TerminalTab {
  id: number;
  /** The launch choice id (`shell` / `cli:<kind>`). */
  shell: string;
  /** The tab's short label (the shell/CLI label). */
  label: string;
}

/** The next monotonic tab id (never reuses a closed id within a session). */
export function nextTabId(tabs: readonly TerminalTab[]): number {
  return tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

/** A short tab title: the choice label + a per-session ordinal. */
export function tabTitle(choice: Pick<ShellChoice, 'label'>, ordinal: number): string {
  return `${choice.label} ${ordinal}`;
}

/** After closing `id`, which tab should become active (neighbor, else undefined). */
export function nextActiveAfterClose(
  tabs: readonly TerminalTab[],
  closingId: number,
  activeId: number | undefined,
): number | undefined {
  if (activeId !== closingId) return activeId; // closed a background tab
  const idx = tabs.findIndex((t) => t.id === closingId);
  const remaining = tabs.filter((t) => t.id !== closingId);
  if (remaining.length === 0) return undefined;
  // Prefer the previous neighbor, else the new first.
  const neighbor = remaining[Math.max(0, idx - 1)] ?? remaining[0];
  return neighbor?.id;
}
