/** StatBlock pure logic (docs/DESIGN.md §6). DOM-free. */

export type DeltaTone = 'accent' | 'danger' | 'dim';

/** Mono delta readout: 3 → "+3", -2 → "-2", 0 → "±0". */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta === 0) return '±0';
  return String(delta);
}

/** Delta → color token family: growth reads on `--accent` (a winning value),
 *  loss on `--danger`, no change stays dim. */
export function deltaTone(delta: number): DeltaTone {
  if (delta > 0) return 'accent';
  if (delta < 0) return 'danger';
  return 'dim';
}
