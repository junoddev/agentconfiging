/**
 * Proves the manifest → parser pipeline shape (SPEC §4.1): parsers consume
 * file CONTENT strings straight from Manifest entries — zero I/O between
 * the manifest and the typed models.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../manifest.js';
import { parseClaudeMd, parseClaudeSettings, parseClaudeSubagent } from './claude.js';
import { parseCursorRule } from './cursor.js';
import { parseMcpJson } from './mcp.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function loadManifest(name: string): Manifest {
  return parseManifest(JSON.parse(fs.readFileSync(path.join(manifestsDir, name), 'utf-8')));
}

function contentOf(manifest: Manifest, filePath: string): string {
  const entry = manifest.files.find((f) => f.path === filePath);
  expect(entry, `manifest entry for ${filePath}`).toBeDefined();
  expect(entry?.content, `content for ${filePath}`).toBeDefined();
  return entry?.content ?? '';
}

describe('manifest → parser pipeline', () => {
  it('parses claude-rich manifest content into typed models', () => {
    const manifest = loadManifest('claude-rich.json');

    const settings = parseClaudeSettings(contentOf(manifest, '.claude/settings.json'));
    expect(settings.ok).toBe(true);
    expect(settings.model?.model).toBe('claude-opus-4-5');
    expect(settings.model?.hooks).toHaveLength(4);

    const subagent = parseClaudeSubagent(contentOf(manifest, '.claude/agents/migration-writer.md'));
    expect(subagent.ok).toBe(true);
    expect(subagent.model?.tools).toContain('SchemaDiff');

    const claudeMd = parseClaudeMd(contentOf(manifest, 'CLAUDE.md'));
    expect(claudeMd.ok).toBe(true);
    expect(claudeMd.model?.imports.map((i) => i.path)).toContain('docs/ROADMAP.md');

    const mcp = parseMcpJson(contentOf(manifest, '.mcp.json'));
    expect(mcp.ok).toBe(true);
    expect(mcp.model?.servers.map((s) => s.name)).toEqual(['postgres', 'bus-inspector', 'docs']);
  });

  it('parses cursor-basic manifest content, including the non-strict-YAML rule', () => {
    const manifest = loadManifest('cursor-basic.json');
    const rule = parseCursorRule(contentOf(manifest, '.cursor/rules/components.mdc'));
    expect(rule.ok).toBe(true);
    expect(rule.model?.globs).toEqual(['*.tsx', 'src/components/**']);
    expect(rule.problems.length).toBeGreaterThan(0);
  });

  it('tolerates manifest entries with omitted content (never parses undefined)', () => {
    const manifest = loadManifest('negative-plain.json');
    const lockEntry = manifest.files.find((f) => f.path === 'package-lock.json');
    expect(lockEntry).toBeDefined();
    expect(lockEntry?.content).toBeUndefined();
    // The pipeline contract: callers gate on `content !== undefined` before parsing.
  });
});
