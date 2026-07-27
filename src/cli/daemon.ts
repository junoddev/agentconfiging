/**
 * `agentconfiging daemon` — the HEADLESS scheduler (SPEC §4/§4.1/§4.3, DESIGN §8,
 * bead agentconfig-ira.4). npx launch sessions are ephemeral, so the always-
 * running piece that fires SCHEDULED pipelines lives here. The daemon is the E9
 * demo gate: a scheduled pipeline runs HEADLESS.
 *
 * HEADLESS by construction: the daemon runs NO Ink (plain timestamped lines, like
 * `report`, per DESIGN §8), opens NO browser, and starts NO PTY / interactive
 * server — it is only the scheduler loop over the committed guarded executor. It
 * reads schedules from the shared state dir, runs due pipelines through the
 * COMMITTED `runPipeline` (bash/http/file/git bounded + scoped to the schedule's
 * instance root), and logs each run to the daemon log file + stdout.
 *
 * MODES: default is a long-running loop (tick on an interval; SIGINT/SIGTERM stop
 * it cleanly and exit 0). `--once` runs every currently-due schedule to completion
 * and exits — the seam for driving the daemon from an external cron and for tests.
 *
 * Every collaborator (clock, scheduler, tick timer, signal registration) is
 * injectable, so tests exercise the whole flow with zero real timers, signals, or
 * pipeline execution.
 */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Scheduler,
  ScheduleStore,
  defaultStateDir,
  isValidPipelineId,
  parsePipeline,
  type PipelineLoader,
} from '../server/index.js';
import {
  createFileLogger,
  formatTerminalLine,
  logFileName,
  resolveLogDir,
  type LogEntry,
  type LogLevel,
} from './logs.js';
import type { ReportIo } from './report.js';

/** Loop tick cadence (ms). Cron granularity is a minute; 20s keeps fires prompt. */
export const TICK_MS = 20_000;

export interface DaemonOptions {
  /** Run every currently-due schedule once, then exit (no loop). */
  once: boolean;
}

/** The scheduler surface the daemon drives (real {@link Scheduler} or a test fake). */
export interface SchedulerLike {
  tick(nowMs: number): Promise<void>;
  runOnce(nowMs: number): Promise<{ ran: number }>;
}

export interface DaemonDeps {
  io: ReportIo;
  now?: () => Date;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  /** State dir holding `pipelines/` + `pipelines/schedules.json`; default shared XDG dir. */
  stateDir?: string;
  /** Scheduler factory; default builds the real one over the state dir. */
  makeScheduler?: (log: (line: string) => void, stateDir: string) => SchedulerLike;
  /** Interval driver (loop mode); default setInterval. Returns a stop function. */
  startTicking?: (onTick: () => void) => () => void;
  /** Signal registration (loop mode); default process SIGINT/SIGTERM. Returns unregister. */
  onShutdown?: (handler: () => void) => () => void;
}

/** Classify a scheduler log line into a terminal token by its leading keyword. */
function levelOf(line: string): LogLevel {
  if (line.startsWith('ERROR')) return 'error';
  if (line.startsWith('WARN')) return 'warn';
  if (line.startsWith('RUN') || line.startsWith('DONE')) return 'signal';
  return 'info';
}

/** Default pipeline loader: read + defensively parse `<stateDir>/pipelines/<id>.json`. */
function defaultPipelineLoader(stateDir: string): PipelineLoader {
  return async (pipelineId) => {
    if (!isValidPipelineId(pipelineId)) return undefined;
    let raw: string;
    try {
      raw = await readFile(path.join(stateDir, 'pipelines', `${pipelineId}.json`), 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const pipeline = parsePipeline(parsed);
    if (pipeline && pipeline.id !== pipelineId) return undefined;
    return pipeline;
  };
}

const defaultStartTicking = (onTick: () => void): (() => void) => {
  const handle = setInterval(onTick, TICK_MS);
  return () => clearInterval(handle);
};

const defaultOnShutdown = (handler: () => void): (() => void) => {
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) process.on(sig, handler);
  return () => {
    for (const sig of signals) process.removeListener(sig, handler);
  };
};

/**
 * Run the daemon. Resolves with the process exit code: 0 for `--once` (after the
 * due schedules run) and 0 when a loop is stopped by a signal.
 */
export async function runDaemon(opts: DaemonOptions, deps: DaemonDeps): Promise<number> {
  const { io } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const homeDir = deps.homeDir ?? os.homedir();
  const stateDir = deps.stateDir ?? defaultStateDir();

  const logPath = path.join(resolveLogDir(env, homeDir), logFileName(now()));
  const logger = createFileLogger(logPath, io.stderr);

  // Plain, timestamped lines to disk always + stdout (NEVER Ink, DESIGN §8).
  const emit = (level: LogLevel, text: string): void => {
    const entry: LogEntry = { time: now(), level, text };
    logger.append(entry);
    io.stdout(`${formatTerminalLine(entry)}\n`);
  };
  const schedulerLog = (line: string): void => emit(levelOf(line), line);

  emit('info', `LOG ${logPath}`);

  const scheduler: SchedulerLike = deps.makeScheduler
    ? deps.makeScheduler(schedulerLog, stateDir)
    : new Scheduler({
        store: new ScheduleStore(stateDir),
        loadPipeline: defaultPipelineLoader(stateDir),
        now: () => now().getTime(),
        log: schedulerLog,
      });

  if (opts.once) {
    emit('signal', 'DAEMON RUN-ONCE');
    const { ran } = await scheduler.runOnce(now().getTime());
    emit('signal', `DAEMON DONE · ${ran} pipeline${ran === 1 ? '' : 's'} run`);
    return 0;
  }

  emit('signal', `DAEMON UP · ticking every ${TICK_MS / 1000}s · state ${stateDir}`);

  return new Promise<number>((resolve) => {
    let stopped = false;
    const runTick = (): void => {
      void scheduler.tick(now().getTime());
    };
    const stopTicking = (deps.startTicking ?? defaultStartTicking)(runTick);
    const shutdown = (): void => {
      if (stopped) return;
      stopped = true;
      stopTicking();
      unregister();
      emit('signal', 'DAEMON DOWN');
      resolve(0);
    };
    const unregister = (deps.onShutdown ?? defaultOnShutdown)(shutdown);
    // Fire an immediate first tick so a schedule already due does not wait a
    // whole interval for its first run.
    runTick();
  });
}
