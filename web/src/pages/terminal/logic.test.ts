/**
 * Pure-logic tests for the embedded terminal (bead ngs.2): the PTY control
 * protocol (encode/parse, hostile shapes rejected), the authenticated WS-URL
 * builder, the xterm theme mapping, and the multi-tab bookkeeping.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPtyWsUrl,
  encodeInput,
  encodeResize,
  nextActiveAfterClose,
  nextTabId,
  parseServerMessage,
  tabTitle,
  withAlpha,
  xtermTheme,
  type TerminalTab,
} from './logic.js';

describe('buildPtyWsUrl', () => {
  it('uses ws:// on http and carries instance + shell as query selectors', () => {
    const url = buildPtyWsUrl(
      { protocol: 'http:', host: '127.0.0.1:8931' },
      { instance: 'abc123', shell: 'cli:claude-code' },
    );
    expect(url).toBe('ws://127.0.0.1:8931/api/pty?instance=abc123&shell=cli%3Aclaude-code');
  });

  it('uses wss:// on https and omits an absent instance', () => {
    const url = buildPtyWsUrl({ protocol: 'https:', host: 'localhost:9000' }, { shell: 'shell' });
    expect(url).toBe('wss://localhost:9000/api/pty?shell=shell');
  });
});

describe('control protocol encode', () => {
  it('encodes input + resize as the mirrored server shapes', () => {
    expect(JSON.parse(encodeInput('ls\r'))).toEqual({ type: 'input', data: 'ls\r' });
    expect(JSON.parse(encodeResize(120, 40))).toEqual({ type: 'resize', cols: 120, rows: 40 });
  });
});

describe('parseServerMessage', () => {
  it('parses output / exit / error', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'output', data: 'hi' }))).toEqual({
      type: 'output',
      data: 'hi',
    });
    expect(parseServerMessage(JSON.stringify({ type: 'exit', code: 0 }))).toEqual({
      type: 'exit',
      code: 0,
    });
    expect(parseServerMessage(JSON.stringify({ type: 'exit' }))).toEqual({ type: 'exit' });
    expect(parseServerMessage(JSON.stringify({ type: 'error', message: 'boom' }))).toEqual({
      type: 'error',
      message: 'boom',
    });
  });

  it('ignores non-string, malformed, and hostile shapes', () => {
    expect(parseServerMessage(42)).toBeUndefined();
    expect(parseServerMessage('not json')).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: 'output', data: 9 }))).toBeUndefined();
    expect(parseServerMessage(JSON.stringify({ type: 'nope' }))).toBeUndefined();
    expect(parseServerMessage(JSON.stringify(null))).toBeUndefined();
  });
});

describe('xtermTheme', () => {
  it('falls back to the Console token equivalents per theme', () => {
    expect(xtermTheme('dark').background).toBe('#0b1014');
    expect(xtermTheme('dark').cursor).toBe('#48c063');
    expect(xtermTheme('light').background).toBe('#f6f9fc');
    expect(xtermTheme('light').foreground).toBe('#121c23');
  });

  it('prefers live resolved token colors over the fallback', () => {
    const theme = xtermTheme('dark', { bg: '#101418', accent: '#22cc66' });
    expect(theme.background).toBe('#101418');
    expect(theme.cursor).toBe('#22cc66');
    // Missing tokens still fall back.
    expect(theme.foreground).toBe('#e3e9ed');
  });

  it('selection is the accent with alpha (8-digit hex)', () => {
    expect(xtermTheme('dark').selectionBackground).toBe(withAlpha('#48c063', 0.35));
    expect(withAlpha('#48c063', 0.35)).toBe('#48c06359');
    // Non-6-digit-hex colors pass through untouched.
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
  });
});

describe('tab bookkeeping', () => {
  const tabs: TerminalTab[] = [
    { id: 1, shell: 'shell', label: 'zsh' },
    { id: 2, shell: 'cli:codex', label: 'codex' },
    { id: 3, shell: 'shell', label: 'zsh' },
  ];

  it('nextTabId is monotonic (never reuses a closed id)', () => {
    expect(nextTabId([])).toBe(1);
    expect(nextTabId(tabs)).toBe(4);
  });

  it('tabTitle labels the choice + ordinal', () => {
    expect(tabTitle({ label: 'claude' }, 2)).toBe('claude 2');
  });

  it('closing a background tab keeps the active one', () => {
    expect(nextActiveAfterClose(tabs, 1, 2)).toBe(2);
  });

  it('closing the active tab falls to the previous neighbor', () => {
    expect(nextActiveAfterClose(tabs, 2, 2)).toBe(1);
  });

  it('closing the only tab clears the active id', () => {
    expect(nextActiveAfterClose([{ id: 5, shell: 'shell', label: 'sh' }], 5, 5)).toBeUndefined();
  });
});
