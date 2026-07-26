import { useEffect, useMemo, useRef } from 'react';
import {
  PULSE_MS,
  deriveAmplitudes,
  pulseGain,
  tracePoints,
  type ConfigSource,
} from './fingerprint.js';
import { useReducedMotion } from './motion.js';
import './signal.css';

/** Samples per second of slow phase scroll while live. */
const SCROLL_SPEED = 4;
/** Afterglow trace lags the live trace by this many samples. */
const AFTERGLOW_LAG = 2.5;

export interface WaveformProps {
  /** Config files this fingerprint hashes. Same sources → same trace.
   *  Compared by reference: pass a stable (memoized) array. A fresh array of
   *  identical content re-derives the amplitudes and restarts the scroll
   *  phase, so the trace visibly jumps for no real config change. */
  sources: readonly ConfigSource[];
  width?: number;
  height?: number;
  /** Increment on each file event to fire a single pulse. */
  pulseKey?: number;
  /** Override the prefers-reduced-motion query (for tests/gallery). */
  reducedMotion?: boolean;
  /** Accessible name, e.g. the agent kind. */
  label?: string;
}

function strokeTrace(
  ctx: CanvasRenderingContext2D,
  amplitudes: readonly number[],
  width: number,
  height: number,
  phase: number,
  gain: number,
  color: string,
): void {
  const points = tracePoints(amplitudes, width, height, phase, gain);
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [i, p] of points.entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/** Waveform fingerprint (DESIGN.md §5): a continuous canvas trace derived
 *  deterministically from config sources — a visual hash. Live mode scrolls
 *  slowly at 60fps with a `--trace-dim` afterglow and pulses once per file
 *  event; reduced motion freezes the trace to its static shape and renders
 *  pulses/config changes as discrete redraws. */
export function Waveform({
  sources,
  width = 120,
  height = 32,
  pulseKey = 0,
  reducedMotion,
  label,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion(reducedMotion);
  const amplitudes = useMemo(() => deriveAmplitudes(sources), [sources]);

  // Pulse start timestamp; null until the first pulseKey change. Kept in a
  // ref so a pulse never restarts the draw loop (phase stays continuous).
  const pulseStartRef = useRef<number | null>(null);
  const lastPulseKeyRef = useRef(pulseKey);
  useEffect(() => {
    if (pulseKey !== lastPulseKeyRef.current) {
      lastPulseKeyRef.current = pulseKey;
      pulseStartRef.current = performance.now();
    }
  }, [pulseKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const draw = (phase: number, gain: number) => {
      const style = getComputedStyle(canvas);
      const signal = style.getPropertyValue('--signal').trim();
      if (!signal) return; // tokens-only: no raw-hex fallback, skip the draw
      const traceDim = style.getPropertyValue('--trace-dim').trim() || signal;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      strokeTrace(ctx, amplitudes, width, height, phase - AFTERGLOW_LAG, gain, traceDim);
      strokeTrace(ctx, amplitudes, width, height, phase, gain, signal);
    };

    if (reduced) {
      // Static shape; a pulse is just the (already applied) discrete redraw.
      draw(0, 1);
      // Live mode re-reads tokens every frame; the static trace would keep
      // stale colors after a paper↔ink toggle, so redraw on theme flips.
      const observer = new MutationObserver(() => draw(0, 1));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
      return () => observer.disconnect();
    }

    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const phase = ((now - t0) / 1000) * SCROLL_SPEED;
      const pulseStart = pulseStartRef.current;
      const gain = pulseStart === null ? 1 : pulseGain(now - pulseStart, PULSE_MS);
      draw(phase, gain);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [amplitudes, width, height, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className="sig-wave"
      style={{ width, height }}
      role="img"
      aria-label={label ?? 'config waveform fingerprint'}
    />
  );
}
