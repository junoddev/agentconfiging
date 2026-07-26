/**
 * CLI log sink — SPEC §4 / DESIGN §8: everything shown in the log pane is
 * also appended to `~/.local/state/agentconfiging/logs/<timestamp>.log`
 * (XDG_STATE_HOME respected, AGENTCONFIGING_LOG_DIR overrides). The path
 * is printed on startup and on crash.
 *
 * Path resolution and line formatting are pure; only createFileLogger
 * touches the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'signal' | 'warn' | 'error';

export interface LogEntry {
  time: Date;
  level: LogLevel;
  text: string;
}

/** Terminal-safe token mapping (DESIGN §8): signal green, warn yellow, error red, dim gray. */
export function levelColor(level: LogLevel): 'green' | 'yellow' | 'red' | 'gray' {
  switch (level) {
    case 'signal':
      return 'green';
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
    case 'info':
      return 'gray';
  }
}

/**
 * Directory for CLI log files. Precedence: AGENTCONFIGING_LOG_DIR override,
 * then $XDG_STATE_HOME/agentconfiging/logs, then ~/.local/state/agentconfiging/logs.
 */
export function resolveLogDir(env: Record<string, string | undefined>, homeDir: string): string {
  const override = env['AGENTCONFIGING_LOG_DIR'];
  if (override !== undefined && override.trim() !== '') return path.resolve(override);
  const xdg = env['XDG_STATE_HOME'];
  const stateHome =
    xdg !== undefined && xdg.trim() !== '' ? xdg : path.join(homeDir, '.local', 'state');
  return path.join(stateHome, 'agentconfiging', 'logs');
}

/** `<timestamp>.log`, filesystem-safe (no colons), second precision. */
export function logFileName(date: Date): string {
  return `${date.toISOString().replace(/:/g, '-').replace(/\..*$/, '')}.log`;
}

/** Line as shown in the terminal (log pane / plain piped output): `HH:MM:SS TEXT`. */
export function formatTerminalLine(entry: LogEntry): string {
  const iso = entry.time.toISOString();
  return `${iso.slice(11, 19)} ${entry.text}`;
}

/**
 * Strip session tokens from a string before it is persisted. The launch URL
 * carries the live session credential (`#token=…` / `?token=…`); the disk
 * log is a 0600 file but must not hold a usable credential regardless. The
 * terminal display keeps the full URL (the browser-open needs the token).
 */
export function redactTokens(text: string): string {
  return text.replace(/[#?&]token=[^\s#?&]*/gi, '');
}

/** Line as appended on disk: full ISO timestamp + level + text (token-redacted). */
export function formatFileLine(entry: LogEntry): string {
  return `${entry.time.toISOString()} ${entry.level.toUpperCase().padEnd(6)} ${redactTokens(entry.text)}`;
}

export interface FileLogger {
  /** Absolute path of the log file (printed on startup and crash). */
  path: string;
  append: (entry: LogEntry) => void;
}

/**
 * Appending file logger. Creates the parent directory eagerly; write
 * failures degrade to a single stderr warning instead of crashing the UI.
 */
export function createFileLogger(
  filePath: string,
  onError?: (message: string) => void,
): FileLogger {
  let broken = false;
  const fail = (err: unknown) => {
    if (broken) return;
    broken = true;
    const message = err instanceof Error ? err.message : String(err);
    onError?.(`agentconfiging: cannot write log file ${filePath}: ${message}\n`);
  };

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Create owner-only (0600): the log may reference loopback URLs and
    // paths. chmod enforces the mode past any permissive umask.
    fs.closeSync(fs.openSync(filePath, 'a', 0o600));
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    fail(err);
  }

  return {
    path: filePath,
    append: (entry) => {
      if (broken) return;
      try {
        fs.appendFileSync(filePath, `${formatFileLine(entry)}\n`);
      } catch (err) {
        fail(err);
      }
    },
  };
}
