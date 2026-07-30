import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileLogger,
  formatFileLine,
  formatTerminalLine,
  levelColor,
  logFileName,
  redactTokens,
  resolveLogDir,
  type LogEntry,
} from './logs.js';

const HOME = '/home/tester';

describe('resolveLogDir', () => {
  it('defaults to ~/.local/state/agentconfiging/logs', () => {
    expect(resolveLogDir({}, HOME)).toBe(
      path.join(HOME, '.local', 'state', 'agentconfiging', 'logs'),
    );
  });

  it('respects XDG_STATE_HOME', () => {
    expect(resolveLogDir({ XDG_STATE_HOME: '/xdg/state' }, HOME)).toBe(
      path.join('/xdg/state', 'agentconfiging', 'logs'),
    );
  });

  it('ignores empty XDG_STATE_HOME', () => {
    expect(resolveLogDir({ XDG_STATE_HOME: '  ' }, HOME)).toBe(
      path.join(HOME, '.local', 'state', 'agentconfiging', 'logs'),
    );
  });

  it('AGENTCONFIGING_LOG_DIR overrides everything', () => {
    expect(
      resolveLogDir({ AGENTCONFIGING_LOG_DIR: '/custom/logs', XDG_STATE_HOME: '/xdg' }, HOME),
    ).toBe('/custom/logs');
  });
});

describe('logFileName', () => {
  it('is timestamp-derived, second precision, no colons', () => {
    const name = logFileName(new Date('2026-07-26T12:30:05.123Z'));
    expect(name).toBe('2026-07-26T12-30-05.log');
    expect(name).not.toContain(':');
  });
});

describe('line formatting', () => {
  const entry: LogEntry = {
    time: new Date('2026-07-26T12:30:05.123Z'),
    level: 'ok',
    text: 'SERVER UP · http://127.0.0.1:4242',
  };

  it('terminal line is HH:MM:SS + text', () => {
    expect(formatTerminalLine(entry)).toBe('12:30:05 SERVER UP · http://127.0.0.1:4242');
  });

  it('file line carries full ISO timestamp and level', () => {
    expect(formatFileLine(entry)).toBe(
      '2026-07-26T12:30:05.123Z OK     SERVER UP · http://127.0.0.1:4242',
    );
  });

  it('maps levels to the terminal-safe token colors', () => {
    expect(levelColor('ok')).toBe('green');
    expect(levelColor('warn')).toBe('yellow');
    expect(levelColor('error')).toBe('red');
    expect(levelColor('info')).toBe('gray');
  });

  it('the terminal line keeps the session token (browser-open needs it)', () => {
    const withToken: LogEntry = {
      time: new Date('2026-07-26T12:30:05.123Z'),
      level: 'ok',
      text: 'OPEN http://127.0.0.1:4242/#token=SEKRET',
    };
    expect(formatTerminalLine(withToken)).toContain('token=SEKRET');
  });

  it('the FILE line redacts the session token from fragment and query URLs', () => {
    const frag: LogEntry = {
      time: new Date(0),
      level: 'info',
      text: 'http://127.0.0.1:4242/#token=SEKRET',
    };
    const query: LogEntry = {
      time: new Date(0),
      level: 'info',
      text: 'http://127.0.0.1:4242/?token=SEKRET&x=1',
    };
    expect(formatFileLine(frag)).not.toContain('token=');
    expect(formatFileLine(frag)).toContain('http://127.0.0.1:4242/');
    expect(formatFileLine(query)).not.toContain('SEKRET');
  });
});

describe('redactTokens', () => {
  it('strips token fragments/queries anywhere in the string', () => {
    expect(redactTokens('SERVER UP · http://127.0.0.1:80/#token=abc')).toBe(
      'SERVER UP · http://127.0.0.1:80/',
    );
    expect(redactTokens('x ?token=abc y')).toBe('x  y');
    expect(redactTokens('no secret here')).toBe('no secret here');
  });
});

describe('createFileLogger', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0)
      fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  });

  it('creates parent directories and appends formatted lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-logs-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'nested', 'run.log');
    const logger = createFileLogger(file);
    logger.append({ time: new Date('2026-07-26T00:00:00.000Z'), level: 'info', text: 'ONE' });
    logger.append({ time: new Date('2026-07-26T00:00:01.000Z'), level: 'warn', text: 'TWO' });
    expect(fs.readFileSync(file, 'utf-8')).toBe(
      '2026-07-26T00:00:00.000Z INFO   ONE\n2026-07-26T00:00:01.000Z WARN   TWO\n',
    );
  });

  it('creates the log file owner-only (0600) and never persists a token', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-logs-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'run.log');
    const logger = createFileLogger(file);
    logger.append({
      time: new Date('2026-07-26T00:00:00.000Z'),
      level: 'ok',
      text: 'SERVER UP · http://127.0.0.1:4242/#token=SEKRET',
    });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('token=');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('SEKRET');
  });

  it('degrades to a single warning when the directory cannot be created', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-logs-'));
    tempDirs.push(dir);
    const blocker = path.join(dir, 'not-a-dir');
    fs.writeFileSync(blocker, 'x');
    const warnings: string[] = [];
    const logger = createFileLogger(path.join(blocker, 'run.log'), (m) => void warnings.push(m));
    logger.append({ time: new Date(), level: 'info', text: 'A' });
    logger.append({ time: new Date(), level: 'info', text: 'B' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('cannot write log file');
  });
});
