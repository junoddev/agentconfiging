/** Waveform fingerprint math (docs/DESIGN.md §5).
 *  Pure functions only — no canvas, no DOM. The Waveform component feeds the
 *  output of these into a raw 2D context; everything testable lives here.
 *
 *  Determinism contract: `deriveAmplitudes` is a visual hash. The same config
 *  sources always yield the identical amplitude array; any change to a path,
 *  size, or hash yields a visibly different one. */

/** One config file feeding an agent's fingerprint. */
export interface ConfigSource {
  path: string;
  size: number;
  /** Content hash (e.g. sha256 hex). Optional — size alone still fingerprints. */
  hash?: string;
}

/** FNV-1a 32-bit hash over a string. Stable across platforms. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical serialization of the sources: order-independent (sorted by path),
 *  every field participates so any config change moves the seed. */
export function canonicalize(sources: readonly ConfigSource[]): string {
  return sources
    .map((s) => `${s.path}\u0000${s.size}\u0000${s.hash ?? ''}`)
    .sort()
    .join('\u0001');
}

/** Derive the amplitude sequence for a set of config sources.
 *  Values are in [0.05, 0.95], lightly smoothed so the trace reads as a
 *  continuous waveform rather than noise. Pure and deterministic. */
export function deriveAmplitudes(sources: readonly ConfigSource[], length = 64): number[] {
  const rand = mulberry32(fnv1a(canonicalize(sources)));
  const raw = Array.from({ length }, () => rand());

  // 3-tap moving average (wrapping) — keeps the trace continuous.
  const smooth = raw.map((_, i) => {
    const prev = raw[(i - 1 + length) % length] ?? 0;
    const cur = raw[i] ?? 0;
    const next = raw[(i + 1) % length] ?? 0;
    return (prev + cur + next) / 3;
  });

  // Rescale to a fixed visual range so every fingerprint uses the full band.
  const min = Math.min(...smooth);
  const max = Math.max(...smooth);
  const span = max - min || 1;
  return smooth.map((v) => 0.05 + ((v - min) / span) * 0.9);
}

export interface TracePoint {
  x: number;
  y: number;
}

/** Sample the amplitude ring into per-pixel polyline points, centered
 *  vertically. `phase` is a float offset in samples (drives the slow scroll);
 *  `gain` scales excursion (drives the file-event pulse). */
export function tracePoints(
  amplitudes: readonly number[],
  width: number,
  height: number,
  phase = 0,
  gain = 1,
): TracePoint[] {
  const n = amplitudes.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const mid = height / 2;
  const half = height / 2 - 1;
  const points: TracePoint[] = [];
  for (let x = 0; x <= width; x++) {
    const pos = (x / width) * n + phase;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a0 = amplitudes[((i0 % n) + n) % n] ?? 0.5;
    const a1 = amplitudes[(((i0 + 1) % n) + n) % n] ?? 0.5;
    const amp = a0 + (a1 - a0) * frac;
    const signed = amp * 2 - 1; // [0.05,0.95] → roughly [-0.9, 0.9]
    const y = mid - Math.max(-1, Math.min(1, signed * gain)) * half;
    points.push({ x, y });
  }
  return points;
}

/** Duration of the file-event pulse, ms. */
export const PULSE_MS = 300;

/** Gain envelope for a file-event pulse: jumps to 1.75× and decays linearly
 *  back to 1 over `duration`. Returns exactly 1 once elapsed. */
export function pulseGain(elapsedMs: number, durationMs = PULSE_MS): number {
  if (elapsedMs < 0 || elapsedMs >= durationMs) return 1;
  return 1 + 0.75 * (1 - elapsedMs / durationMs);
}
