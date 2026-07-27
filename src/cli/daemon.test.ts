/**
 * Daemon tests (bead ira.4). The scheduler, clock, tick timer, and signal
 * registration are injected, so both modes run with zero real timers/signals/
 * pipeline execution. Pinned here: `--once` runs due schedules then exits 0; the
 * loop starts ticking, then a shutdown signal stops the timer, unregisters, and
 * exits 0; and output is PLAIN (timestamped lines, never Ink / no ANSI, DESIGN §8).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDaemon, type SchedulerLike } from './daemon.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-daemon-'));
  tempDirs.push(dir);
  return dir;
}

interface Captured {
  stdout: string;
  stderr: string;
}
function ioSink(): { io: { stdout: (s: string) => void; stderr: (s: string) => void } } & Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (s) => void out.push(s), stderr: (s) => void err.push(s) },
    get stdout() {
      return out.join('');
    },
    get stderr() {
      return err.join('');
    },
  };
}

const FIXED = new Date(2024, 0, 1, 9, 0, 0);

describe('runDaemon --once', () => {
  it('runs currently-due schedules once and exits 0 with plain, non-Ink output', async () => {
    const sink = ioSink();
    const dir = tmp();
    const scheduler: SchedulerLike = {
      tick: vi.fn(async () => {}),
      runOnce: vi.fn(async () => ({ ran: 2 })),
    };
    const code = await runDaemon(
      { once: true },
      {
        io: sink.io,
        now: () => FIXED,
        env: { AGENTCONFIGING_LOG_DIR: dir },
        homeDir: dir,
        stateDir: dir,
        makeScheduler: () => scheduler,
      },
    );
    expect(code).toBe(0);
    expect(scheduler.runOnce).toHaveBeenCalledTimes(1);
    expect(scheduler.tick).not.toHaveBeenCalled();
    // Plain timestamped lines (HH:MM:SS prefix), never Ink.
    expect(/^\d{2}:\d{2}:\d{2} /m.test(sink.stdout)).toBe(true);
    expect(sink.stdout).toContain('DAEMON RUN-ONCE');
    expect(sink.stdout).toContain('DAEMON DONE · 2 pipelines run');
    // eslint-disable-next-line no-control-regex
    expect(/\[/.test(sink.stdout)).toBe(false);
  });

  it('writes the same lines to a log file under the log dir', async () => {
    const sink = ioSink();
    const dir = tmp();
    await runDaemon(
      { once: true },
      {
        io: sink.io,
        now: () => FIXED,
        env: { AGENTCONFIGING_LOG_DIR: dir },
        homeDir: dir,
        stateDir: dir,
        makeScheduler: () => ({ tick: vi.fn(), runOnce: vi.fn(async () => ({ ran: 0 })) }),
      },
    );
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'));
    expect(files.length).toBe(1);
    const body = fs.readFileSync(path.join(dir, files[0]!), 'utf8');
    expect(body).toContain('DAEMON DONE · 0 pipelines run');
  });
});

describe('runDaemon loop mode', () => {
  it('ticks, then a shutdown signal stops the timer, unregisters, and exits 0', async () => {
    const sink = ioSink();
    const dir = tmp();
    const scheduler: SchedulerLike = {
      tick: vi.fn(async () => {}),
      runOnce: vi.fn(async () => ({ ran: 0 })),
    };
    const stop = vi.fn();
    const unregister = vi.fn();
    let captured: (() => void) | undefined;

    const promise = runDaemon(
      { once: false },
      {
        io: sink.io,
        now: () => FIXED,
        env: { AGENTCONFIGING_LOG_DIR: dir },
        homeDir: dir,
        stateDir: dir,
        makeScheduler: () => scheduler,
        startTicking: (onTick) => {
          onTick(); // simulate one interval fire
          return stop;
        },
        onShutdown: (handler) => {
          captured = handler;
          return unregister;
        },
      },
    );

    expect(captured).toBeDefined();
    expect(scheduler.tick).toHaveBeenCalled(); // interval tick + immediate first tick
    captured!(); // deliver SIGINT/SIGTERM
    const code = await promise;

    expect(code).toBe(0);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(sink.stdout).toContain('DAEMON UP');
    expect(sink.stdout).toContain('DAEMON DOWN');
  });

  it('a repeated shutdown is idempotent (stop/unregister called once)', async () => {
    const sink = ioSink();
    const dir = tmp();
    const stop = vi.fn();
    const unregister = vi.fn();
    let captured: (() => void) | undefined;
    const promise = runDaemon(
      { once: false },
      {
        io: sink.io,
        now: () => FIXED,
        env: { AGENTCONFIGING_LOG_DIR: dir },
        homeDir: dir,
        stateDir: dir,
        makeScheduler: () => ({ tick: vi.fn(), runOnce: vi.fn(async () => ({ ran: 0 })) }),
        startTicking: () => stop,
        onShutdown: (handler) => {
          captured = handler;
          return unregister;
        },
      },
    );
    captured!();
    captured!(); // second delivery — must be a no-op
    await promise;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
