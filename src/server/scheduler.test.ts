/**
 * Scheduler tests (bead ira.4). The clock, schedule source, pipeline loader, and
 * RUN seam are all injected, so the whole due/overlap/error surface is exercised
 * with ZERO real timers or pipeline execution. The default runner (proven in a
 * dedicated case) drives the COMMITTED guarded executor `runPipeline`; here an
 * injected runner records that the guarded path is taken with the right
 * pipeline + instance root.
 */

import { describe, expect, it, vi } from 'vitest';
import { Scheduler, type ScheduledRunner, type ScheduleSource } from './scheduler.js';
import type { Schedule } from './schedule/index.js';
import type { PipelineResult } from './pipeline/index.js';
import type { Pipeline } from '../core/pipeline/index.js';

const ROOT = '/tmp/instance-root';

function pipeline(id: string): Pipeline {
  return {
    id,
    name: `Pipeline ${id}`,
    nodes: [{ id: 'n1', name: 'In', type: 'input' } as Pipeline['nodes'][number]],
    edges: [],
  };
}

/** An in-memory schedule source; records set() calls (used to assert lastRunAt persistence). */
function source(schedules: Schedule[]): ScheduleSource & { saved: Schedule[] } {
  const map = new Map(schedules.map((s) => [s.pipelineId, s]));
  return {
    saved: [],
    list: () => Promise.resolve([...map.values()]),
    set(s: Schedule) {
      map.set(s.pipelineId, s);
      (this as { saved: Schedule[] }).saved.push(s);
      return Promise.resolve(s);
    },
  };
}

const okResult: PipelineResult = { status: 'ok', nodes: {}, outputs: {} };

function schedule(over: Partial<Schedule> = {}): Schedule {
  return { pipelineId: 'demo', cron: '*/15 * * * *', enabled: true, instanceRoot: ROOT, ...over };
}

/** Build a local-time instant (epoch ms) from calendar components. */
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo, d, h, mi).getTime();
}

describe('Scheduler.runOnce (once mode — catch-up)', () => {
  it('runs an enabled, due schedule through the runner with the bound instance root', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    const src = source([schedule()]);
    const log: string[] = [];
    const scheduler = new Scheduler({
      store: src,
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => at(2024, 0, 1, 9, 0),
      log: (l) => log.push(l),
    });

    const { ran } = await scheduler.runOnce();
    expect(ran).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
    const arg = runner.mock.calls[0]![0];
    expect(arg.pipeline.id).toBe('demo');
    expect(arg.instanceRoot).toBe(ROOT);
    // lastRunAt persisted so a repeat --once at the same instant does not re-fire.
    expect(src.saved.at(-1)?.lastRunAt).toBe(at(2024, 0, 1, 9, 0));
    expect(log.some((l) => l.startsWith('RUN demo'))).toBe(true);
    expect(log.some((l) => l.startsWith('DONE demo · status ok'))).toBe(true);
  });

  it('does not re-run an occurrence already served (lastRunAt fresh)', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    // Already ran exactly at this occurrence.
    const src = source([schedule({ lastRunAt: at(2024, 0, 1, 9, 0) })]);
    const scheduler = new Scheduler({
      store: src,
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => at(2024, 0, 1, 9, 5),
      log: () => {},
    });
    const { ran } = await scheduler.runOnce();
    expect(ran).toBe(0);
    expect(runner).not.toHaveBeenCalled();
  });

  it('skips a disabled schedule', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    const scheduler = new Scheduler({
      store: source([schedule({ enabled: false })]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => at(2024, 0, 1, 9, 0),
      log: () => {},
    });
    expect((await scheduler.runOnce()).ran).toBe(0);
    expect(runner).not.toHaveBeenCalled();
  });

  it('logs + continues when a run throws', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => {
      throw new Error('boom');
    });
    const log: string[] = [];
    const scheduler = new Scheduler({
      store: source([schedule()]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => at(2024, 0, 1, 9, 0),
      log: (l) => log.push(l),
    });
    const { ran } = await scheduler.runOnce();
    expect(ran).toBe(1); // counted as attempted
    expect(log.some((l) => l.startsWith('ERROR demo · run failed: boom'))).toBe(true);
  });

  it('logs + skips when the pipeline is missing/invalid', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    const log: string[] = [];
    const scheduler = new Scheduler({
      store: source([schedule()]),
      loadPipeline: () => Promise.resolve(undefined),
      runner,
      now: () => at(2024, 0, 1, 9, 0),
      log: (l) => log.push(l),
    });
    await scheduler.runOnce();
    expect(runner).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith('ERROR demo · pipeline missing'))).toBe(true);
  });

  it('warns + skips a schedule whose cron is invalid', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    const log: string[] = [];
    const scheduler = new Scheduler({
      store: source([schedule({ cron: 'not-a-cron' })]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => at(2024, 0, 1, 9, 0),
      log: (l) => log.push(l),
    });
    await scheduler.runOnce();
    expect(runner).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith('WARN demo · invalid cron'))).toBe(true);
  });
});

describe('Scheduler.tick (loop mode)', () => {
  it('does not fire a boundary that elapsed before the daemon started', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    // Scheduler starts at 09:05 (past the 09:00 boundary); a fresh schedule
    // (no lastRunAt) should NOT retro-fire 09:00.
    let clock = at(2024, 0, 1, 9, 5);
    const scheduler = new Scheduler({
      store: source([schedule()]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => clock,
      log: () => {},
    });
    await scheduler.tick(clock);
    expect(runner).not.toHaveBeenCalled();

    // Advance to the next boundary (09:15) → fires.
    clock = at(2024, 0, 1, 9, 15);
    await scheduler.tick(clock);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('fires only once per boundary across repeated ticks', async () => {
    const runner = vi.fn<ScheduledRunner>(async () => okResult);
    let clock = at(2024, 0, 1, 9, 5);
    const scheduler = new Scheduler({
      store: source([schedule()]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => clock,
      log: () => {},
    });
    clock = at(2024, 0, 1, 9, 15);
    await scheduler.tick(clock);
    await scheduler.tick(at(2024, 0, 1, 9, 16)); // same boundary
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('overlap guard: skips a second fire while the first run is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner = vi.fn<ScheduledRunner>(async () => {
      await gate;
      return okResult;
    });
    const log: string[] = [];
    // Start before 09:00 so the first boundary (09:00) is eligible.
    let clock = at(2024, 0, 1, 8, 59);
    const scheduler = new Scheduler({
      store: source([schedule()]),
      loadPipeline: (id) => Promise.resolve(pipeline(id)),
      runner,
      now: () => clock,
      log: (l) => log.push(l),
    });

    clock = at(2024, 0, 1, 9, 0);
    await scheduler.tick(clock); // fires (run pending on the gate)
    clock = at(2024, 0, 1, 9, 15);
    await scheduler.tick(clock); // due again, but previous run still active → SKIP
    expect(runner).toHaveBeenCalledTimes(1);
    expect(log.some((l) => l.startsWith('SKIP demo · previous run still active'))).toBe(true);

    release();
    await Promise.resolve();
  });
});
