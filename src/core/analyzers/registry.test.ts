/**
 * Footgun guard for analyzer auto-discovery (SPEC §4.1) — same pattern as
 * src/core/detectors/registry.test.ts: fs-read the REAL directory listing
 * and assert every analyzer module file is represented in the registry.
 * Adding an analyzer file without its barrel import fails here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allAnalyzers, registerAnalyzer } from './index.js';

const analyzersDir = import.meta.dirname;

/** Non-analyzer infrastructure and data modules living in this directory. */
const INFRA = new Set([
  'index.ts',
  'registry.ts',
  'shared.ts',
  'types.ts',
  'known-tools.ts',
  'stale-models.ts',
]);

const analyzerFiles = fs
  .readdirSync(analyzersDir)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !INFRA.has(name));

describe('analyzer registry auto-discovery', () => {
  it('finds analyzer module files on disk', () => {
    expect(analyzerFiles.length).toBeGreaterThanOrEqual(13);
  });

  it('every analyzer module file in the directory is registered (id === file basename)', () => {
    const ids = new Set(allAnalyzers().map((a) => a.id));
    for (const file of analyzerFiles) {
      const expectedId = path.basename(file, '.ts');
      expect(ids, `${file} is not registered — missing its import in index.ts?`).toContain(
        expectedId,
      );
    }
  });

  it('every registered analyzer has a module file (no orphan registrations)', () => {
    const basenames = new Set(analyzerFiles.map((file) => path.basename(file, '.ts')));
    for (const analyzer of allAnalyzers()) {
      expect(basenames, `registered id '${analyzer.id}' has no module file`).toContain(analyzer.id);
    }
  });

  it('registers the expected analyzer set', () => {
    expect(allAnalyzers().map((a) => a.id)).toEqual([
      'broken-import',
      'conflicting-instructions',
      'duplicate-rules',
      'hook-script-missing',
      'mcp-command-not-on-path',
      'missing-project-guide',
      'no-agents-no-skills',
      'permissive-permissions',
      'quality-bloat',
      'rules-drift',
      'settings-local-committed',
      'stale-model-ref',
      'subagent-references-missing-tool',
      'tiny-project-guide',
    ]);
  });

  it('rejects duplicate registration', () => {
    const existing = allAnalyzers()[0];
    expect(existing).toBeDefined();
    if (!existing) return;
    expect(() => registerAnalyzer(existing)).toThrow(/already registered/);
  });
});
