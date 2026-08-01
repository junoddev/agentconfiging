/**
 * Pipelines SCHEDULE helpers (bead ira.4) — small pure functions for the
 * schedule control on the Pipelines page. The daemon (`agentconfiging daemon`)
 * is what actually fires schedules; the UI here just sets the cron/preset and
 * shows the server-computed next-run. Kept pure + tested; the page owns the wiring.
 */

/** Named presets offered in the schedule control (mirror the server's PRESETS subset). */
export const SCHEDULE_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '@hourly', label: 'hourly' },
  { value: '@daily', label: 'daily (midnight)' },
  { value: '@weekly', label: 'weekly (Sun)' },
  { value: '@monthly', label: 'monthly (1st)' },
];

/** Format a next-run epoch-ms as a local timestamp, or an em dash when none. */
export function formatNextRun(nextRun: number | null | undefined): string {
  if (nextRun === null || nextRun === undefined) return '—';
  return new Date(nextRun).toLocaleString();
}

/** Format a last-run epoch-ms as a local timestamp, or 'never'. */
export function formatLastRun(lastRunAt: number | null | undefined): string {
  if (lastRunAt === null || lastRunAt === undefined) return 'never';
  return new Date(lastRunAt).toLocaleString();
}

export type ScheduleTargetState =
  | { state: 'unset'; targetRoot?: string }
  | { state: 'matched'; scheduleRoot: string; targetRoot: string }
  | { state: 'mismatch'; scheduleRoot: string; targetRoot: string }
  | { state: 'orphaned'; scheduleRoot: string };

/** Reconcile the persisted schedule root with the page's explicit Operate target. */
export function scheduleTargetState(
  schedule: { instanceRoot: string } | null | undefined,
  targetRoot: string | undefined,
): ScheduleTargetState {
  if (!schedule)
    return targetRoot === undefined ? { state: 'unset' } : { state: 'unset', targetRoot };
  if (targetRoot === undefined) return { state: 'orphaned', scheduleRoot: schedule.instanceRoot };
  if (schedule.instanceRoot === targetRoot) {
    return { state: 'matched', scheduleRoot: schedule.instanceRoot, targetRoot };
  }
  return { state: 'mismatch', scheduleRoot: schedule.instanceRoot, targetRoot };
}

/** Compact status text for the schedule control; roots are filesystem data. */
export function scheduleTargetLabel(state: ScheduleTargetState): string {
  switch (state.state) {
    case 'unset':
      return state.targetRoot === undefined ? 'target none' : `target ${state.targetRoot}`;
    case 'matched':
      return `bound ${state.scheduleRoot}`;
    case 'mismatch':
      return `bound ${state.scheduleRoot} · page ${state.targetRoot}`;
    case 'orphaned':
      return `bound ${state.scheduleRoot} · page none`;
  }
}
