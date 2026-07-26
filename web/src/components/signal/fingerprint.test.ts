import { describe, expect, it } from 'vitest';
import {
  PULSE_MS,
  canonicalize,
  deriveAmplitudes,
  fnv1a,
  mulberry32,
  pulseGain,
  tracePoints,
  type ConfigSource,
} from './fingerprint.js';

const manifest: ConfigSource[] = [
  { path: 'CLAUDE.md', size: 3120, hash: 'a1b2c3' },
  { path: '.claude/settings.json', size: 512, hash: 'd4e5f6' },
];

describe('fnv1a / mulberry32', () => {
  it('is stable for a known input', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('CLAUDE.md')).toBe(fnv1a('CLAUDE.md'));
    expect(fnv1a('CLAUDE.md')).not.toBe(fnv1a('claude.md'));
  });

  it('yields identical sequences from identical seeds, in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('canonicalize', () => {
  it('is order-independent', () => {
    expect(canonicalize(manifest)).toBe(canonicalize([...manifest].reverse()));
  });

  it('changes when any field changes', () => {
    const base = canonicalize(manifest);
    expect(canonicalize([manifest[0]!, { ...manifest[1]!, size: 513 }])).not.toBe(base);
    expect(canonicalize([manifest[0]!, { ...manifest[1]!, hash: 'ffffff' }])).not.toBe(base);
  });
});

describe('deriveAmplitudes (visual hash)', () => {
  it('same input → identical array', () => {
    expect(deriveAmplitudes(manifest)).toEqual(deriveAmplitudes(manifest));
    expect(deriveAmplitudes(manifest)).toEqual(deriveAmplitudes([...manifest].reverse()));
  });

  it('different input → different array', () => {
    const base = deriveAmplitudes(manifest);
    const sizeChanged = deriveAmplitudes([manifest[0]!, { ...manifest[1]!, size: 513 }]);
    const hashChanged = deriveAmplitudes([manifest[0]!, { ...manifest[1]!, hash: 'ffffff' }]);
    expect(sizeChanged).not.toEqual(base);
    expect(hashChanged).not.toEqual(base);
  });

  it('respects length and stays in the visual band', () => {
    const amps = deriveAmplitudes(manifest, 48);
    expect(amps).toHaveLength(48);
    for (const a of amps) {
      // 1e-9 slack: the rescale arithmetic can land an ulp outside the band.
      expect(a).toBeGreaterThanOrEqual(0.05 - 1e-9);
      expect(a).toBeLessThanOrEqual(0.95 + 1e-9);
    }
    // Uses the full band after rescaling.
    expect(Math.min(...amps)).toBeCloseTo(0.05, 10);
    expect(Math.max(...amps)).toBeCloseTo(0.95, 10);
  });

  it('handles an empty source list deterministically', () => {
    expect(deriveAmplitudes([])).toEqual(deriveAmplitudes([]));
  });

  it('matches the pinned fingerprint (guards the canonical separator bytes)', () => {
    // Pinned against the U+0000 / U+0001 separators. If this fails, the
    // canonical serialization changed and every stored fingerprint moved.
    expect(fnv1a(canonicalize(manifest))).toBe(4088639821);
    const amps = deriveAmplitudes(manifest);
    const pinned = [0.7289623043917431, 0.8495854044272952, 0.7866224979784361, 0.6124024287550524];
    for (const [i, expected] of pinned.entries()) {
      expect(amps[i]).toBeCloseTo(expected, 12);
    }
  });
});

describe('tracePoints', () => {
  const amps = deriveAmplitudes(manifest);

  it('emits one point per pixel, inside the canvas box', () => {
    const pts = tracePoints(amps, 120, 32);
    expect(pts).toHaveLength(121);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(32);
    }
  });

  it('is phase-shiftable and clamps gain excursion', () => {
    const still = tracePoints(amps, 120, 32, 0);
    const shifted = tracePoints(amps, 120, 32, 7.5);
    expect(shifted).not.toEqual(still);
    const boosted = tracePoints(amps, 120, 32, 0, 10);
    for (const p of boosted) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(32);
    }
  });

  it('returns empty for degenerate input', () => {
    expect(tracePoints([], 120, 32)).toEqual([]);
    expect(tracePoints(amps, 0, 32)).toEqual([]);
  });
});

describe('pulseGain', () => {
  it('boosts at onset and decays to exactly 1', () => {
    expect(pulseGain(0)).toBeCloseTo(1.75);
    expect(pulseGain(PULSE_MS / 2)).toBeGreaterThan(1);
    expect(pulseGain(PULSE_MS / 2)).toBeLessThan(1.75);
    expect(pulseGain(PULSE_MS)).toBe(1);
    expect(pulseGain(PULSE_MS * 4)).toBe(1);
    expect(pulseGain(-5)).toBe(1);
  });

  it('decays monotonically', () => {
    let prev = Infinity;
    for (let t = 0; t <= PULSE_MS; t += 30) {
      const g = pulseGain(t);
      expect(g).toBeLessThanOrEqual(prev);
      prev = g;
    }
  });
});
