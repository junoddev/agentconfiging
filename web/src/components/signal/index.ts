/** Signal-layer primitives (docs/DESIGN.md §5). */
export { Waveform, type WaveformProps } from './Waveform.js';
export { VuMeter, type VuMeterProps } from './VuMeter.js';
export { LiveDot, type LiveDotProps } from './LiveDot.js';
export { SweepOverlay, SWEEP_MS, type SweepOverlayProps } from './SweepOverlay.js';
export { deriveAmplitudes, type ConfigSource } from './fingerprint.js';
export { litSegments, segmentTones, type SegmentTone } from './vu.js';
export { useReducedMotion, resolveReducedMotion } from './motion.js';
