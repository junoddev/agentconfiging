/**
 * Drift guard for the discovery marker tables (see markers.ts header):
 * every marker row must correspond to a real detector match trigger. Each
 * row is turned into a minimal synthetic Manifest and the attributed
 * detector must match it — a detector signal change that invalidates a
 * row fails here instead of silently desyncing discovery from detection.
 */

import { describe, expect, it } from 'vitest';
import { allDetectors } from '../detectors/index.js';
import type { Manifest } from '../manifest.js';
import { RUNTIME_FORMATS } from '../runtimes/index.js';
import {
  COPILOT_RUNTIME,
  DIR_MARKERS,
  FILE_MARKERS,
  GITHUB_COPILOT_DIR,
  GITHUB_COPILOT_FILE,
  GITHUB_DIR,
} from './markers.js';

function manifestWith(filePath: string): Manifest {
  return {
    root: '/synthetic',
    cwdBasename: 'synthetic',
    files: [{ path: filePath, size: 1, sha256: '0'.repeat(64) }],
    stats: { fileCount: 1, totalBytes: 1 },
    scope: 'project',
  };
}

function detectorById(id: string) {
  return allDetectors().find((d) => d.id === id);
}

/**
 * The runtime id the discovery walker would attribute to a RUNTIME_FORMATS
 * detection marker (exact file path, or dir prefix when ending in '/'), or
 * undefined when the walker cannot represent it.
 */
function discoveryRuntimeForMarker(marker: string): string | undefined {
  if (
    marker === `${GITHUB_DIR}/${GITHUB_COPILOT_FILE}` ||
    marker === `${GITHUB_DIR}/${GITHUB_COPILOT_DIR}/`
  ) {
    return COPILOT_RUNTIME;
  }
  if (marker.endsWith('/')) return DIR_MARKERS.get(marker.slice(0, -1));
  return FILE_MARKERS.get(marker);
}

describe('discovery marker tables', () => {
  it('attribute only registered detector ids', () => {
    const ids = new Set(allDetectors().map((d) => d.id));
    for (const runtime of [...FILE_MARKERS.values(), ...DIR_MARKERS.values(), COPILOT_RUNTIME]) {
      expect(ids).toContain(runtime);
    }
  });

  it('every file marker alone triggers its detector', () => {
    for (const [name, runtime] of FILE_MARKERS) {
      const detector = detectorById(runtime);
      expect(detector, `detector ${runtime} for marker ${name}`).toBeDefined();
      expect(detector?.matches(manifestWith(name)), `${runtime} should match ${name}`).toBe(true);
    }
  });

  it('every dir marker with any file under it triggers its detector', () => {
    for (const [name, runtime] of DIR_MARKERS) {
      const detector = detectorById(runtime);
      expect(detector, `detector ${runtime} for marker ${name}`).toBeDefined();
      expect(
        detector?.matches(manifestWith(`${name}/anything.md`)),
        `${runtime} should match ${name}/`,
      ).toBe(true);
    }
  });

  it('reverse guard: every first-class RUNTIME_FORMATS detection marker is discoverable', () => {
    // RUNTIME_FORMATS detectionMarkers are cross-checked against detector
    // matches() by runtimes.test.ts; requiring them here too means a new
    // detector trigger cannot land without discovery learning it.
    for (const runtime of RUNTIME_FORMATS.filter((r) => r.firstClass)) {
      for (const marker of runtime.detectionMarkers) {
        expect(
          discoveryRuntimeForMarker(marker),
          `${runtime.id} marker ${marker} must be in the discovery tables`,
        ).toBe(runtime.id);
      }
    }
  });

  it('reverse guard: every registered detector id appears in at least one marker row', () => {
    const covered = [...FILE_MARKERS.values(), ...DIR_MARKERS.values(), COPILOT_RUNTIME];
    for (const detector of allDetectors()) {
      expect(covered, `detector ${detector.id} has no discovery marker`).toContain(detector.id);
    }
  });

  it('both .github copilot triggers match the copilot detector', () => {
    const detector = detectorById(COPILOT_RUNTIME);
    expect(detector).toBeDefined();
    expect(detector?.matches(manifestWith(`${GITHUB_DIR}/${GITHUB_COPILOT_FILE}`))).toBe(true);
    expect(detector?.matches(manifestWith(`${GITHUB_DIR}/${GITHUB_COPILOT_DIR}/config.yml`))).toBe(
      true,
    );
  });
});
