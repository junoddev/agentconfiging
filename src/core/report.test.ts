/**
 * Report composition tests (SPEC §4.1): fixture manifest → detect →
 * buildAnalyzerInput → runAnalyzers, all pure. Pins the fixture findings
 * matrix the bead requires: claude-rich fires broken-import +
 * missing-tool, multi-runtime fires duplicate/drift, negative-plain is
 * clean.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detect } from './detectors/index.js';
import { parseManifest, type Manifest } from './manifest.js';
import { buildAnalyzerInput, buildReport, runAnalyzers, type AnalyzerEnv } from './report.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function loadManifest(name: string): Manifest {
  return parseManifest(JSON.parse(fs.readFileSync(path.join(manifestsDir, name), 'utf-8')));
}

function report(name: string, env?: AnalyzerEnv) {
  const manifest = loadManifest(name);
  return buildReport(manifest, detect(manifest), env);
}

describe('buildAnalyzerInput', () => {
  it('parses claude-rich into the typed artifact view', () => {
    const manifest = loadManifest('claude-rich.json');
    const input = buildAnalyzerInput(manifest, detect(manifest));
    expect(input.parsed.claudeMd?.model.imports.length).toBeGreaterThan(0);
    expect(input.parsed.settings?.model.model).toBe('claude-opus-4-5');
    expect(input.parsed.localSettings?.path).toBe('.claude/settings.local.json');
    expect(input.parsed.subagents.map((s) => s.model.name).sort()).toEqual([
      'code-reviewer',
      'migration-writer',
    ]);
    expect(input.parsed.skills).toHaveLength(2);
    expect(input.parsed.commands).toHaveLength(2);
    expect(input.parsed.rules).toHaveLength(2);
    expect(input.parsed.mcp?.model.servers).toHaveLength(3);
    expect(input.env).toBeUndefined();
  });

  it('parses multi-runtime guides and cursor rules', () => {
    const manifest = loadManifest('multi-runtime.json');
    const input = buildAnalyzerInput(manifest, detect(manifest));
    expect(input.parsed.guides.map((g) => g.path).sort()).toEqual([
      '.cursorrules',
      '.github/copilot-instructions.md',
      'AGENTS.md',
      'CLAUDE.md',
    ]);
    expect(input.parsed.cursorRules.map((r) => r.path)).toEqual(['.cursor/rules/fastify.mdc']);
  });
});

describe('fixture findings matrix', () => {
  it('claude-rich: broken-import, missing-tool, settings-local-committed', () => {
    const { findings } = report('claude-rich.json');
    expect(findings.map((f) => f.id)).toEqual([
      'settings-local-committed',
      'broken-import-docs-roadmap-md',
      'subagent-references-missing-tool-migration-writer-schemadiff',
    ]);
  });

  it('claude-rich with an env bag additionally fires mcp-command-not-on-path', () => {
    const { findings } = report('claude-rich.json', { pathCommands: ['node'] });
    expect(findings.map((f) => f.id)).toContain('mcp-command-not-on-path-postgres-npx');
  });

  it('multi-runtime: duplicate + drift findings', () => {
    const { findings } = report('multi-runtime.json');
    expect(findings.map((f) => f.id)).toEqual([
      'conflicting-instructions-claude-md-agents-md',
      'duplicate-rules-cursorrules-and-cursor-rules',
      'no-agents-no-skills',
      'rules-drift',
    ]);
  });

  it('negative-plain: no agents, zero findings', () => {
    const manifest = loadManifest('negative-plain.json');
    const result = buildReport(manifest, detect(manifest));
    expect(result.agents).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

describe('finding id uniqueness', () => {
  it('uniquifies colliding slug ids with -2, -3 suffixes', () => {
    // docs/x.md and docs.x.md both slugify to docs-x-md.
    const manifest: Manifest = {
      root: '/tmp/proj',
      cwdBasename: 'proj',
      files: [
        {
          path: 'CLAUDE.md',
          size: 0,
          sha256: '0'.repeat(64),
          content: '# X\n\nSee @docs/x.md and @docs.x.md\n',
        },
      ],
      stats: { fileCount: 1, totalBytes: 0 },
    };
    const findings = runAnalyzers(buildAnalyzerInput(manifest, detect(manifest)));
    const brokenImports = findings.filter((f) => f.id.startsWith('broken-import')).map((f) => f.id);
    expect(brokenImports).toEqual(['broken-import-docs-x-md', 'broken-import-docs-x-md-2']);
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
  });
});

describe('determinism', () => {
  it('produces identical, sorted findings across runs', () => {
    const manifest = loadManifest('claude-rich.json');
    const agents = detect(manifest);
    const a = runAnalyzers(buildAnalyzerInput(manifest, agents));
    const b = runAnalyzers(buildAnalyzerInput(manifest, agents));
    expect(a).toEqual(b);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < a.length; i += 1) {
      const prev = a[i - 1];
      const curr = a[i];
      if (!prev || !curr) continue;
      expect(rank[prev.severity]).toBeLessThanOrEqual(rank[curr.severity]);
    }
  });
});
