/** StatBlock pure logic (docs/DESIGN.md §6). DOM-free. */

export type DeltaTone = 'signal' | 'red' | 'dim';

/** Mono delta readout: 3 → "+3", -2 → "-2", 0 → "±0". */
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta === 0) return '±0';
  return String(delta);
}

/** Delta → color token family: growth reads on `--signal`, loss on `--red`,
 *  no change stays dim. */
export function deltaTone(delta: number): DeltaTone {
  if (delta > 0) return 'signal';
  if (delta < 0) return 'red';
  return 'dim';
}
