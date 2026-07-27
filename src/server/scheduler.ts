/**
 * scheduler — the headless engine that RUNS due pipelines (SPEC §5 row 12, E9
 * Scheduler, bead agentconfig-ira.4). Given the persisted schedules + a clock, it
 * finds which pipelines are due and runs each through the COMMITTED guarded
 * executor (`runPipeline` from src/server/pipeline — bash/http/file/git bounded +
 * scoped to the schedule's instance root; NEVER bypassed). It owns no timer of
 * its own: `tick(now)` (loop mode) and `runOnce(now)` (one-shot) are driven by
 * the daemon (src/cli/daemon.ts) with an injectable clock, so tests exercise the
 * whole due/overlap/error surface with zero real timers or side effects.
 *
 * DUE DETECTION: a schedule is due when its most-recent cron occurrence at-or-
 * before `now` ({@link computePrevRun}) is newer than the last time it was served.
 * "Served" is the in-process record, else the persisted `lastRunAt`, else a
 * mode-dependent baseline: in LOOP mode the daemon's start time (so a boundary
 * that elapsed before the daemon came up is NOT retro-fired), in ONCE mode
 * negative-infinity (so an externally cron-driven `daemon --once` catches up any
 * unserved occurrence). Each handled occurrence advances `lastRunAt` (persisted),
 * so a boundary fires at most once.
 *
 * OVERLAP GUARD: a pipeline whose previous scheduled run is still in flight is
 * SKIPPED for this occurrence (logged) rather than run concurrently. ERROR
 * RESILIENCE: a pipeline that is missing/invalid, or whose run throws, is logged
 * and the rest of the schedule continues — one bad pipeline never stalls the loop.
 */

import { runPipeline } from './pipeline/index.js';
import type { PipelineResult, RuntimeContext, RuntimeMap } from './pipeline/index.js';
import { computePrevRun, parseCron } from './schedule/index.js';
import type { Schedule } from './schedule/index.js';
import type { Pipeline } from '../core/pipeline/index.js';

/** Loads a saved pipeline by id (defensively parsed), or undefined when absent/invalid. */
export type PipelineLoader = (pipelineId: string) => Promise<Pipeline | undefined>;

/** Minimal schedule source the scheduler reads each tick (a {@link ScheduleStore}). */
export interface ScheduleSource {
  list(): Promise<Schedule[]>;
  set(schedule: Schedule): Promise<Schedule>;
}

/**
 * The seam that actually runs a due pipeline. The default drives the COMMITTED
 * guarded executor (`runPipeline`) with an instance-root-scoped context — the
 * ONLY execution path. Injectable so tests assert the guarded path is taken with
 * zero real bash/http/git/fs.
 */
export type ScheduledRunner = (args: {
  pipeline: Pipeline;
  instanceRoot: string;
  now: () => number;
  runtimes?: RuntimeMap;
}) => Promise<PipelineResult>;

/** Production runner: the committed guarded executor, headless, scoped to the instance root. */
const defaultRunner: ScheduledRunner = ({ pipeline, instanceRoot, now, runtimes }) => {
  const ctx: RuntimeContext = { instanceRoot, now };
  // A scheduled run takes no ad-hoc input; {{input}} resolves to undefined.
  return runPipeline(pipeline, undefined, ctx, runtimes ? { runtimes } : {});
};

export interface SchedulerConfig {
  store: ScheduleSource;
  loadPipeline: PipelineLoader;
  /** Run seam; defaults to the committed guarded executor. */
  runner?: ScheduledRunner;
  /** Executor runtime table; defaults to the real committed node runtimes. */
  runtimes?: RuntimeMap;
  /** Clock (epoch ms); defaults to Date.now. */
  now?: () => number;
  /** Plain-line log sink (the daemon timestamps + persists each line). */
  log: (line: string) => void;
}

type Mode = 'loop' | 'once';

export class Scheduler {
  readonly #store: ScheduleSource;
  readonly #loadPipeline: PipelineLoader;
  readonly #runner: ScheduledRunner;
  readonly #runtimes: RuntimeMap | undefined;
  readonly #now: () => number;
  readonly #log: (line: string) => void;
  readonly #startedAt: number;
  /** pipelineId → epoch-ms of the occurrence most recently handled this process. */
  readonly #served = new Map<string, number>();
  /** pipelineIds with a run currently in flight (the overlap guard). */
  readonly #running = new Set<string>();

  constructor(config: SchedulerConfig) {
    this.#store = config.store;
    this.#loadPipeline = config.loadPipeline;
    this.#runner = config.runner ?? defaultRunner;
    this.#runtimes = config.runtimes;
    this.#now = config.now ?? (() => Date.now());
    this.#log = config.log;
    this.#startedAt = this.#now();
  }

  /** True when `schedule` has an unserved cron occurrence at-or-before `nowMs`. */
  #isDue(schedule: Schedule, nowMs: number, mode: Mode): boolean {
    if (!schedule.enabled) return false;
    const parsed = parseCron(schedule.cron);
    if ('error' in parsed) {
      this.#log(`WARN ${schedule.pipelineId} · invalid cron "${schedule.cron}": ${parsed.error}`);
      return false;
    }
    const prev = computePrevRun(parsed, new Date(nowMs));
    if (!prev) return false;
    const baseline = mode === 'loop' ? this.#startedAt : Number.NEGATIVE_INFINITY;
    const served = this.#served.get(schedule.pipelineId) ?? schedule.lastRunAt ?? baseline;
    return prev.getTime() > served;
  }

  /** Advance the served marker + persist `lastRunAt` (best-effort). */
  async #markServed(schedule: Schedule, nowMs: number): Promise<void> {
    this.#served.set(schedule.pipelineId, nowMs);
    try {
      await this.#store.set({ ...schedule, lastRunAt: nowMs });
    } catch (err) {
      // A state-dir write failure must not stall scheduling; the in-memory
      // served marker still prevents a re-fire this process.
      this.#log(`WARN ${schedule.pipelineId} · could not persist lastRunAt: ${message(err)}`);
    }
  }

  /** Run one pipeline through the guarded executor, logging start + outcome. Never throws. */
  async #execute(schedule: Schedule): Promise<void> {
    const pipeline = await this.#loadPipeline(schedule.pipelineId);
    if (!pipeline) {
      this.#log(`ERROR ${schedule.pipelineId} · pipeline missing or invalid — skipped`);
      return;
    }
    this.#log(`RUN ${schedule.pipelineId} (${pipeline.name}) · instance ${schedule.instanceRoot}`);
    try {
      const result = await this.#runner({
        pipeline,
        instanceRoot: schedule.instanceRoot,
        now: this.#now,
        ...(this.#runtimes ? { runtimes: this.#runtimes } : {}),
      });
      this.#log(`DONE ${schedule.pipelineId} · status ${result.status}`);
    } catch (err) {
      // A failed run is logged and the schedule continues (error resilience).
      this.#log(`ERROR ${schedule.pipelineId} · run failed: ${message(err)}`);
    }
  }

  /**
   * LOOP-mode tick: fire every due schedule (fire-and-forget, overlap-guarded)
   * and return once they are dispatched. The daemon calls this on an interval.
   */
  async tick(nowMs: number = this.#now()): Promise<void> {
    let schedules: Schedule[];
    try {
      schedules = await this.#store.list();
    } catch (err) {
      this.#log(`WARN · could not read schedules: ${message(err)}`);
      return;
    }
    for (const schedule of schedules) {
      if (!this.#isDue(schedule, nowMs, 'loop')) continue;
      await this.#markServed(schedule, nowMs);
      if (this.#running.has(schedule.pipelineId)) {
        this.#log(`SKIP ${schedule.pipelineId} · previous run still active`);
        continue;
      }
      this.#running.add(schedule.pipelineId);
      void this.#execute(schedule).finally(() => this.#running.delete(schedule.pipelineId));
    }
  }

  /**
   * ONCE-mode: run every currently-due schedule to completion (sequentially, so
   * no overlap is possible) and return how many ran. Used by `daemon --once`.
   */
  async runOnce(nowMs: number = this.#now()): Promise<{ ran: number }> {
    let schedules: Schedule[];
    try {
      schedules = await this.#store.list();
    } catch (err) {
      this.#log(`WARN · could not read schedules: ${message(err)}`);
      return { ran: 0 };
    }
    let ran = 0;
    for (const schedule of schedules) {
      if (!this.#isDue(schedule, nowMs, 'once')) continue;
      await this.#markServed(schedule, nowMs);
      await this.#execute(schedule);
      ran += 1;
    }
    return { ran };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
