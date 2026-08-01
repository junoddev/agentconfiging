/**
 * schedule/store — the SCHEDULE model + persistence (SPEC §5 row 12, E9
 * Scheduler, bead agentconfig-ira.4). A Schedule binds a saved pipeline to a
 * cron/preset trigger and an instance root. Schedules live in ONE JSON file
 * under the shared state dir alongside pipelines; the daemon reads it every tick
 * and the interactive server's schedule route writes it.
 *
 * UNTRUSTED FILE DISCIPLINE: the schedules file is user-owned state — no more
 * trusted than a pipeline file. Every read parses DEFENSIVELY ({@link parseSchedule}:
 * pipelineId re-validated to the traversal-safe charset, cron re-validated, shape
 * checked) and a malformed entry is dropped, never thrown. pipelineId is only ever
 * a JSON object KEY, never spliced into a filesystem path.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidPipelineId } from '../pipeline-routes.js';
import { isPlainObject } from '../http.js';
import { isValidCron } from './cron.js';

/**
 * A pipeline's schedule. `cron` is a cron expression or a named preset;
 * `instanceRoot` pins the run's bash/git cwd + file scope (recorded when the
 * schedule is saved from a resolved instance); `lastRunAt` is the epoch-ms of the
 * most recent scheduled run (updated by the scheduler; drives due-detection so a
 * restarted daemon does not double-fire a boundary it already served).
 */
export interface Schedule {
  pipelineId: string;
  cron: string;
  enabled: boolean;
  instanceRoot: string;
  lastRunAt?: number;
}

/**
 * Defensively parse an UNTRUSTED value into a Schedule, or `undefined` when the
 * shape is wrong / the pipelineId or cron is invalid. Never throws.
 */
export function parseSchedule(raw: unknown): Schedule | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { pipelineId, cron, enabled, instanceRoot, lastRunAt } = raw;
  if (!isValidPipelineId(pipelineId)) return undefined;
  if (typeof cron !== 'string' || !isValidCron(cron)) return undefined;
  if (typeof enabled !== 'boolean') return undefined;
  if (typeof instanceRoot !== 'string' || instanceRoot === '') return undefined;
  const schedule: Schedule = { pipelineId, cron, enabled, instanceRoot };
  if (typeof lastRunAt === 'number' && Number.isFinite(lastRunAt)) {
    schedule.lastRunAt = lastRunAt;
  }
  return schedule;
}

/**
 * Single-file store for pipeline schedules, at `<stateDir>/pipelines/schedules.json`.
 * The file maps pipelineId → Schedule. Reads are resilient (missing / malformed
 * file / bad entries → those entries are simply absent). Writes are last-wins.
 */
export class ScheduleStore {
  readonly #file: string;

  constructor(stateDir: string) {
    this.#file = path.join(stateDir, 'pipelines', 'schedules.json');
  }

  /** Every well-formed schedule, keyed by pipelineId. Bad entries are dropped. */
  async readAll(): Promise<Record<string, Schedule>> {
    let raw: string;
    try {
      raw = await readFile(this.#file, 'utf8');
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!isPlainObject(parsed)) return {};
    const out: Record<string, Schedule> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const schedule = parseSchedule(value);
      // The file's own key MUST match the entry's pipelineId (a renamed key
      // cannot masquerade for another pipeline).
      if (schedule && schedule.pipelineId === key) out[key] = schedule;
    }
    return out;
  }

  /** Every well-formed schedule as a list (order unspecified). */
  async list(): Promise<Schedule[]> {
    return Object.values(await this.readAll());
  }

  async get(pipelineId: string): Promise<Schedule | undefined> {
    return (await this.readAll())[pipelineId];
  }

  /** Upsert a schedule (last-wins) and persist. Returns the stored value. */
  async set(schedule: Schedule): Promise<Schedule> {
    const all = await this.readAll();
    all[schedule.pipelineId] = schedule;
    await this.#write(all);
    return schedule;
  }

  /** Remove a schedule; returns true when one was present. */
  async delete(pipelineId: string): Promise<boolean> {
    const all = await this.readAll();
    if (!(pipelineId in all)) return false;
    delete all[pipelineId];
    await this.#write(all);
    return true;
  }

  async #write(all: Record<string, Schedule>): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true });
    await writeFile(this.#file, JSON.stringify(all, null, 2), 'utf8');
  }
}
