/**
 * Instruction-sync engine barrel (SPEC §4.1, E5 — bead agentconfig-wmc.10).
 *
 * Pure format-mapping between runtimes' instruction files. No I/O — the server
 * reads the source + writes the plan through the guarded write path.
 */

export { syncPlan, syncStatus, targetPath } from './engine.js';
export type { SyncPlanEntry, SyncSource, SyncStatus } from './types.js';
