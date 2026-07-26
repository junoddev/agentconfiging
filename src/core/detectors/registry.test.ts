/**
 * Footgun guard for detector auto-discovery (SPEC §4.1).
 *
 * The tsup ESM bundle cannot fs-readdir source dirs at runtime, so
 * discovery is: self-registration on import + one explicit side-effect
 * import per module in index.ts. This test closes the gap the Elixir
 * hardcoded list left open: it fs-reads the REAL directory listing and
 * asserts every detector module file is represented in the registry.
 * Adding a detector file without its barrel import fails here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allDetectors, registerDetector } from './index.js';

// This test file lives in the detectors directory itself — anchor the
// listing there, independent of the test runner's cwd.
const detectorsDir = import.meta.dirname;

/** Non-detector infrastructure modules living in this directory. */
const INFRA = new Set(['index.ts', 'registry.ts', 'shared.ts', 'types.ts']);

const detectorFiles = fs
  .readdirSync(detectorsDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !INFRA.has(name));

describe('detector registry auto-discovery', () => {
  it('finds detector module files on disk', () => {
    expect(detectorFiles.length).toBeGreaterThanOrEqual(8);
  });

  it('every detector module file in the directory is registered (id === file basename)', () => {
    const ids = new Set(allDetectors().map((d) => d.id));
    for (const file of detectorFiles) {
      const expectedId = path.basename(file, '.ts');
      expect(ids, `${file} is not registered — missing its import in index.ts?`).toContain(
        expectedId,
      );
    }
  });

  it('every registered detector has a module file (no orphan registrations)', () => {
    const basenames = new Set(detectorFiles.map((file) => path.basename(file, '.ts')));
    for (const detector of allDetectors()) {
      expect(basenames, `registered id '${detector.id}' has no module file`).toContain(detector.id);
    }
  });

  it('registers the 8 ported runtimes', () => {
    expect(allDetectors().map((d) => d.id)).toEqual([
      'aider',
      'claude-code',
      'codex',
      'continue',
      'copilot',
      'cursor',
      'gemini-cli',
      'opencode',
    ]);
  });

  it('rejects duplicate registration', () => {
    const existing = allDetectors()[0];
    expect(existing).toBeDefined();
    if (!existing) return;
    expect(() => registerDetector(existing)).toThrow(/already registered/);
  });
});
