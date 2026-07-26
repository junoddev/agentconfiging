import { describe, expect, it } from 'vitest';
import { deriveAmplitudes } from '../components/signal/index.js';
import {
  CLAUDE_SOURCES,
  CODEX_SOURCES,
  VU_LEVELS,
  buildDemoDiff,
  buildDemoFindings,
} from './fixtures.js';

describe('demo sources', () => {
  it('are non-empty with unique paths', () => {
    for (const sources of [CLAUDE_SOURCES, CODEX_SOURCES]) {
      expect(sources.length).toBeGreaterThan(0);
      expect(new Set(sources.map((s) => s.path)).size).toBe(sources.length);
    }
  });

  it('produce distinct waveform fingerprints', () => {
    expect(deriveAmplitudes(CLAUDE_SOURCES)).not.toEqual(deriveAmplitudes(CODEX_SOURCES));
  });
});

describe('buildDemoFindings', () => {
  it('covers every severity', () => {
    const severities = new Set(buildDemoFindings().map((f) => f.severity));
    expect(severities).toEqual(new Set(['error', 'warn', 'ok']));
  });

  it('covers fix-with-apply, fix-only, and bare states', () => {
    const findings = buildDemoFindings();
    expect(findings.some((f) => f.fix !== undefined && f.applicable)).toBe(true);
    expect(findings.some((f) => f.fix !== undefined && !f.applicable)).toBe(true);
    expect(findings.some((f) => f.fix === undefined)).toBe(true);
  });

  it('uses sequential 1-based indexes', () => {
    expect(buildDemoFindings().map((f) => f.index)).toEqual([1, 2, 3]);
  });
});

describe('buildDemoDiff', () => {
  it('is multi-hunk with valid headers and non-empty hunks', () => {
    const hunks = buildDemoDiff();
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    for (const hunk of hunks) {
      expect(hunk.header).toMatch(/^@@ /);
      expect(hunk.lines.length).toBeGreaterThan(0);
    }
  });

  it('exercises add, del, and ctx line kinds', () => {
    const kinds = new Set(buildDemoDiff().flatMap((h) => h.lines.map((l) => l.kind)));
    expect(kinds).toEqual(new Set(['add', 'del', 'ctx']));
  });
});

describe('VU_LEVELS', () => {
  it('spans dead to full scale, strictly ascending', () => {
    expect(VU_LEVELS[0]).toBe(0);
    expect(VU_LEVELS[VU_LEVELS.length - 1]).toBe(1);
    for (let i = 1; i < VU_LEVELS.length; i++) {
      expect(VU_LEVELS[i]!).toBeGreaterThan(VU_LEVELS[i - 1]!);
    }
  });

  it('includes the default warn range (>= 0.8)', () => {
    expect(VU_LEVELS.some((l) => l >= 0.8 && l < 1)).toBe(true);
  });
});
