import { deltaTone, formatDelta } from './stat.js';
import './components.css';

export interface StatBlockProps {
  /** The hero numeral (or short figure like "98%"). */
  value: number | string;
  /** Micro-label under the numeral, e.g. "AGENTS". */
  label: string;
  /** Optional mono delta, e.g. +3 since last scan. */
  delta?: number;
  /** Numeral size: 96px (xl, default) or 64px (md). */
  size?: 'xl' | 'md';
}

/** Stat block (DESIGN.md §6): giant numeral + micro-label + optional mono
 *  delta, hairline-boxed. The numeral is the hero. */
export function StatBlock({ value, label, delta, size = 'xl' }: StatBlockProps) {
  return (
    <div className="statblock">
      <div className={size === 'xl' ? 'numeral-giant' : 'numeral-giant numeral-giant--sm'}>
        {value}
      </div>
      <div className="micro-label">
        {label}
        {delta !== undefined && (
          <span className={`mono-data statblock__delta statblock__delta--${deltaTone(delta)}`}>
            {' '}
            {formatDelta(delta)}
          </span>
        )}
      </div>
    </div>
  );
}
