import { segmentTones } from './vu.js';
import './signal.css';

export interface VuMeterProps {
  /** Level in [0, 1]. */
  level: number;
  /** Segment count (default 10). */
  segments?: number;
  /** Fraction of the meter where lit segments switch to `--warn`. */
  warnFrom?: number;
  /** Accessible name, e.g. "detector confidence". */
  label?: string;
}

/** Segmented VU meter (DESIGN.md §5): 2px-gapped rects, `▮▮▮▯` — never a
 *  smooth progress bar. Static chassis; only its state changes. */
export function VuMeter({ level, segments = 10, warnFrom = 0.8, label }: VuMeterProps) {
  const tones = segmentTones(level, segments, warnFrom);
  return (
    <span
      className="sig-vu"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.min(1, Math.max(0, level))}
      aria-label={label ?? 'level'}
    >
      {tones.map((tone, i) => (
        <span
          key={i}
          className={tone === 'off' ? 'sig-vu__seg' : `sig-vu__seg sig-vu__seg--${tone}`}
        />
      ))}
    </span>
  );
}
