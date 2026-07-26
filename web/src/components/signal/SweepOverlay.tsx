import { useEffect, useState } from 'react';
import { useReducedMotion } from './motion.js';
import './signal.css';

/** Sweep duration, ms (DESIGN.md §5: one 300ms pass). */
export const SWEEP_MS = 300;

export interface SweepOverlayProps {
  /** Increment on each watcher-triggered re-analysis to run one sweep.
   *  0 (initial) never sweeps. */
  sweepKey: number;
  /** Override the prefers-reduced-motion query (for tests/gallery). */
  reducedMotion?: boolean;
}

/** Rescan sweep (DESIGN.md §5): a 1px vertical `--signal` line sweeps the
 *  parent panel once in 300ms. Mount inside a `position: relative` panel.
 *  No skeleton loaders anywhere; reduced motion renders nothing — the
 *  re-analysis result itself is the discrete state change. */
export function SweepOverlay({ sweepKey, reducedMotion }: SweepOverlayProps) {
  const reduced = useReducedMotion(reducedMotion);
  const [activeKey, setActiveKey] = useState(0);

  useEffect(() => {
    if (reduced) {
      // Reduced motion flipping on mid-sweep must tear the line down —
      // animationend never fires once the CSS animation is disabled.
      setActiveKey(0);
      return;
    }
    if (sweepKey === 0) return;
    setActiveKey(sweepKey);
    // Fallback teardown in case animationend never fires (hidden panel etc.).
    const timer = setTimeout(() => setActiveKey(0), SWEEP_MS + 100);
    return () => clearTimeout(timer);
  }, [sweepKey, reduced]);

  if (activeKey === 0 || reduced) return null;
  return (
    <span className="sig-sweep" aria-hidden="true">
      <span key={activeKey} className="sig-sweep__line" onAnimationEnd={() => setActiveKey(0)} />
    </span>
  );
}
