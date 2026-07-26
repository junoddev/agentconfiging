/**
 * Runtime format table tests (SPEC §4.1):
 *   1. Schema completeness — every entry carries the required fields, all
 *      paths are relative, ids are unique kebab-case.
 *   2. Accessor behavior.
 *   3. Cross-check — first-class entries line up 1:1 with detector modules,
 *      and every first-class detectionMarker is a real match trigger of the
 *      corresponding detector (a synthetic one-file manifest containing just
 *      that marker makes the detector match).
 */

import { describe, expect, it } from 'vitest';
import { allDetectors } from '../detectors/index.js';
import type { Manifest } from '../manifest.js';
import {
  RUNTIME_FORMATS,
  detectionLiteMarkers,
  getRuntimeFormat,
  listRuntimeFormats,
  listSyncTargets,
} from './index.js';

const FIRST_CLASS_IDS = [
  'aider',
  'claude-code',
  'codex',
  'continue',
  'copilot',
  'cursor',
  'gemini-cli',
  'opencode',
];

const LONG_TAIL_IDS = ['amazon-q', 'cline', 'junie', 'qodo', 'roo', 'windsurf', 'zed'];

function isRelative(path: string): boolean {
  return !path.startsWith('/') && !path.startsWith('~') && !path.includes('..');
}

describe('runtime format table schema', () => {
  it('has unique kebab-case ids covering first-class + long-tail runtimes', () => {
    const ids = RUNTIME_FORMATS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect([...ids].sort()).toEqual([...FIRST_CLASS_IDS, ...LONG_TAIL_IDS].sort());
  });

  it('every entry has non-empty required fields', () => {
    for (const r of RUNTIME_FORMATS) {
      expect(r.displayName.length, r.id).toBeGreaterThan(0);
      expect(r.instructionPaths.length, r.id).toBeGreaterThan(0);
      expect(r.detectionMarkers.length, r.id).toBeGreaterThan(0);
      expect(r.scaffoldPath.length, r.id).toBeGreaterThan(0);
      expect(r.scaffoldTemplate.length, r.id).toBeGreaterThan(0);
      expect(r.docsUrl, r.id).toMatch(/^https:\/\//);
      expect(['verified', 'unverified'], r.id).toContain(r.confidence);
    }
  });

  it('instruction paths, markers, and scaffold paths are project-relative', () => {
    for (const r of RUNTIME_FORMATS) {
      for (const p of [...r.instructionPaths, ...r.detectionMarkers, r.scaffoldPath]) {
        expect(isRelative(p), `${r.id}: ${p}`).toBe(true);
      }
      for (const g of r.globalPaths ?? []) {
        expect(g.startsWith('~/'), `${r.id}: ${g}`).toBe(true);
      }
    }
  });

  it('has no duplicate instruction paths or markers within an entry', () => {
    for (const r of RUNTIME_FORMATS) {
      expect(new Set(r.instructionPaths).size, r.id).toBe(r.instructionPaths.length);
      expect(new Set(r.detectionMarkers).size, r.id).toBe(r.detectionMarkers.length);
    }
  });

  it('rulesDirPattern is present exactly when the layout includes a rules dir', () => {
    for (const r of RUNTIME_FORMATS) {
      if (r.layout === 'single-file') {
        expect(r.rulesDirPattern, r.id).toBeUndefined();
      } else {
        expect(r.rulesDirPattern, r.id).toBeDefined();
        const dir = r.instructionPaths.find((p) => p.endsWith('/'));
        expect(dir, r.id).toBeDefined();
        expect(r.rulesDirPattern?.startsWith(dir ?? ''), r.id).toBe(true);
      }
    }
  });

  it('scaffoldPath is a primary instruction file or lives in a rules dir candidate', () => {
    for (const r of RUNTIME_FORMATS) {
      const ok = r.instructionPaths.some((p) =>
        p.endsWith('/') ? r.scaffoldPath.startsWith(p) : r.scaffoldPath === p,
      );
      expect(ok, `${r.id}: ${r.scaffoldPath}`).toBe(true);
    }
  });

  it('flags exactly the detector-backed runtimes as first-class', () => {
    const firstClass = RUNTIME_FORMATS.filter((r) => r.firstClass).map((r) => r.id);
    expect([...firstClass].sort()).toEqual(FIRST_CLASS_IDS);
  });
});

describe('accessors', () => {
  it('getRuntimeFormat returns the entry, or undefined for unknown ids', () => {
    expect(getRuntimeFormat('cline')?.displayName).toBe('Cline');
    expect(getRuntimeFormat('windsurf')?.instructionPaths).toContain('.windsurfrules');
    expect(getRuntimeFormat('nope')).toBeUndefined();
  });

  it('listRuntimeFormats returns all entries sorted by id', () => {
    const ids = listRuntimeFormats().map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toHaveLength(RUNTIME_FORMATS.length);
  });

  it('listSyncTargets returns every entry, first-class before long-tail', () => {
    const targets = listSyncTargets();
    expect(targets).toHaveLength(RUNTIME_FORMATS.length);
    expect(targets.slice(0, FIRST_CLASS_IDS.length).map((r) => r.id)).toEqual(FIRST_CLASS_IDS);
    expect(targets.slice(FIRST_CLASS_IDS.length).map((r) => r.id)).toEqual(LONG_TAIL_IDS);
  });

  it('detectionLiteMarkers flattens (runtimeId, marker) pairs across the table', () => {
    const markers = detectionLiteMarkers();
    const expected = RUNTIME_FORMATS.reduce((n, r) => n + r.detectionMarkers.length, 0);
    expect(markers).toHaveLength(expected);
    expect(markers).toContainEqual({ runtimeId: 'zed', marker: '.rules' });
    expect(markers).toContainEqual({ runtimeId: 'amazon-q', marker: '.amazonq/' });
    expect(markers).toContainEqual({ runtimeId: 'claude-code', marker: 'CLAUDE.md' });
  });
});

describe('cross-check against detector modules', () => {
  const detectorIds = allDetectors().map((d) => d.id);

  it('first-class entries correspond 1:1 to registered detectors', () => {
    const firstClass = RUNTIME_FORMATS.filter((r) => r.firstClass)
      .map((r) => r.id)
      .sort();
    expect(firstClass).toEqual([...detectorIds].sort());
  });

  it('long-tail entries have no detector module', () => {
    for (const r of RUNTIME_FORMATS.filter((x) => !x.firstClass)) {
      expect(detectorIds, r.id).not.toContain(r.id);
    }
  });

  it('every first-class detectionMarker is a match trigger of its detector', () => {
    for (const r of RUNTIME_FORMATS.filter((x) => x.firstClass)) {
      const detector = allDetectors().find((d) => d.id === r.id);
      expect(detector, r.id).toBeDefined();
      for (const marker of r.detectionMarkers) {
        const filePath = marker.endsWith('/') ? `${marker}placeholder.md` : marker;
        const manifest: Manifest = {
          root: '/fake',
          cwdBasename: 'fake',
          scope: 'project',
          files: [{ path: filePath, size: 1, sha256: '0'.repeat(64), content: 'x' }],
          stats: { fileCount: 1, totalBytes: 1 },
        };
        expect(detector?.matches(manifest), `${r.id}: ${marker}`).toBe(true);
      }
    }
  });
});
