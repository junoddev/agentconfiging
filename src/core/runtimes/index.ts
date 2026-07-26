/**
 * Runtimes barrel — runtime instruction-format knowledge (SPEC §4.1).
 *
 * Pure accessors over the data table in `table.ts`; no I/O, no per-runtime
 * logic. Consumers: the instruction sync engine (E5), runtime scaffolding,
 * and detection-lite for long-tail runtimes without detector modules.
 */

import { RUNTIME_FORMATS } from './table.js';
import type { DetectionLiteMarker, RuntimeFormat } from './types.js';

export { RUNTIME_FORMATS } from './table.js';
export type {
  DetectionLiteMarker,
  FactConfidence,
  InstructionFormat,
  InstructionLayout,
  RuntimeFormat,
} from './types.js';

function byId(a: RuntimeFormat, b: RuntimeFormat): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The entry for a runtime id, or undefined for unknown ids. */
export function getRuntimeFormat(id: string): RuntimeFormat | undefined {
  return RUNTIME_FORMATS.find((r) => r.id === id);
}

/** All entries, sorted by id for deterministic output. */
export function listRuntimeFormats(): RuntimeFormat[] {
  return [...RUNTIME_FORMATS].sort(byId);
}

/**
 * All instruction sync targets — every table entry is one by design (the
 * long-tail entries exist precisely to be sync targets without full
 * detection). Ordered first-class first, then by id, so sync UIs list the
 * detected-capable runtimes before the long tail.
 */
export function listSyncTargets(): RuntimeFormat[] {
  return [...RUNTIME_FORMATS].sort((a, b) =>
    a.firstClass === b.firstClass ? byId(a, b) : a.firstClass ? -1 : 1,
  );
}

/**
 * Flattened detection-lite markers across all runtimes, in listRuntimeFormats
 * order. A marker ending in '/' is a directory prefix; otherwise it is an
 * exact project-relative file path.
 */
export function detectionLiteMarkers(): DetectionLiteMarker[] {
  return listRuntimeFormats().flatMap((r) =>
    r.detectionMarkers.map((marker) => ({ runtimeId: r.id, marker })),
  );
}
