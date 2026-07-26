/** Segmented VU meter math (docs/DESIGN.md §5). Pure — the VuMeter component
 *  only maps these tones onto 2px-gapped rects. */

export type SegmentTone = 'off' | 'signal' | 'warn';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Number of lit segments for a level in [0, 1]. Any non-zero level lights at
 *  least one segment; only a full 1.0 lights them all. */
export function litSegments(level: number, segments: number): number {
  if (segments <= 0) return 0;
  const l = clamp01(level);
  if (l === 0) return 0;
  if (l === 1) return segments;
  return Math.min(segments - 1, Math.max(1, Math.round(l * segments)));
}

/** Tone per segment: lit segments render `--signal`, except lit segments in
 *  the high range (index ≥ warnFrom × segments) which render `--warn`. */
export function segmentTones(level: number, segments: number, warnFrom = 0.8): SegmentTone[] {
  const lit = litSegments(level, segments);
  const warnStart = Math.ceil(clamp01(warnFrom) * segments);
  return Array.from({ length: segments }, (_, i) => {
    if (i >= lit) return 'off';
    return i >= warnStart ? 'warn' : 'signal';
  });
}
