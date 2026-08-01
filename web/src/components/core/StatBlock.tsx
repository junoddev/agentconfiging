import { deltaTone, formatDelta } from './stat.js';
import './components.css';

export interface StatBlockProps {
  /** The stat figure (22px mono), e.g. 14 or "98%". */
  value: number | string;
  /** 12px muted label under the number, e.g. "Rules". */
  label: string;
  /** Optional second line for compact context, e.g. "48K budget · ok". */
  caption?: string;
  /** Optional mono delta beside the label, e.g. +3 since last scan. */
  delta?: number;
  /** Makes the tile a button — clickable wayfinding into the section. */
  onClick?: () => void;
}

/** Stat tile (DESIGN.md §5 `.tile`): 22px mono number + 12px muted label;
 *  hover raises the border to `--muted`. Wayfinding, not marketing stats. */
export function StatBlock({ value, label, caption, delta, onClick }: StatBlockProps) {
  const body = (
    <>
      <div className="t-num">{value}</div>
      <div className="t-label">
        {label}
        {delta !== undefined && (
          <span className={`t-delta t-delta--${deltaTone(delta)}`}> {formatDelta(delta)}</span>
        )}
      </div>
      {caption !== undefined && <div className="t-caption">{caption}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="tile" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="tile">{body}</div>;
}
