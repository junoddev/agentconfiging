import { useReducedMotion } from './motion.js';
import './signal.css';

export interface LiveDotProps {
  /** Watcher connection state. */
  connected: boolean;
  /** Override the prefers-reduced-motion query (for tests/gallery). */
  reducedMotion?: boolean;
}

/** LIVE indicator (DESIGN.md §5): 8px square (Swiss — not a circle) in
 *  `--signal`, 1.2s pulse only while the watcher is connected. Disconnected
 *  flips it to a hollow square + OFFLINE. Reduced motion: no pulse — the
 *  filled/hollow square and text carry the state discretely. */
export function LiveDot({ connected, reducedMotion }: LiveDotProps) {
  const reduced = useReducedMotion(reducedMotion);
  const dotClass = connected
    ? `sig-live__dot${reduced ? '' : ' sig-live__dot--pulse'}`
    : 'sig-live__dot sig-live__dot--offline';
  return (
    <span className="sig-live micro-label" role="status">
      <span className={dotClass} aria-hidden="true" />
      {connected ? 'LIVE' : 'OFFLINE'}
    </span>
  );
}
