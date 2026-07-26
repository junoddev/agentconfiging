import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from './manifest.js';

const manifestsDir = path.resolve(process.cwd(), 'fixtures/manifests');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(manifestsDir, name), 'utf-8'));
}

describe('parseManifest on the fixture corpus', () => {
  it('accepts claude-basic.json and returns a typed Manifest', () => {
    const manifest: Manifest = parseManifest(loadFixture('claude-basic.json'));
    expect(manifest.root).toBe('/home/user/projects/taskboard');
    expect(manifest.cwdBasename).toBe('taskboard');
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0]?.path).toBe('.claude/settings.json');
    expect(manifest.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.stats.fileCount).toBe(2);
    expect(manifest.stats.totalBytes).toBe(515);
    // Fixtures carry no scope/localOnly — both stay undefined.
    expect(manifest.scope).toBeUndefined();
    expect(manifest.localOnly).toBeUndefined();
  });

  it('accepts codex-global.json (global-scope fixture rooted at a dot-dir)', () => {
    const manifest: Manifest = parseManifest(loadFixture('codex-global.json'));
    expect(manifest.root).toBe('/home/user/.codex');
    expect(manifest.cwdBasename).toBe('.codex');
    expect(manifest.files.map((f) => f.path)).toEqual(['AGENTS.md', 'config.toml']);
  });

  it('tolerates content-less file entries (negative-plain.json)', () => {
    const manifest = parseManifest(loadFixture('negative-plain.json'));
    const contentless = manifest.files.filter((f) => f.content === undefined);
    expect(contentless.length).toBeGreaterThan(0);
    for (const file of contentless) {
      expect(typeof file.sha256).toBe('string');
      expect(typeof file.size).toBe('number');
    }
  });

  it('every checked-in fixture manifest parses', () => {
    const names = fs.readdirSync(manifestsDir).filter((n) => n.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(() => parseManifest(loadFixture(name))).not.toThrow();
    }
  });
});

describe('parseManifest validation errors', () => {
  it('rejects non-objects and empty objects', () => {
    expect(() => parseManifest(null)).toThrow(/Invalid manifest/);
    expect(() => parseManifest([])).toThrow(/Invalid manifest/);
    expect(() => parseManifest({})).toThrow(/Invalid manifest/);
  });

  it('rejects file entries missing sha256', () => {
    expect(() =>
      parseManifest({
        root: '/r',
        cwdBasename: 'r',
        files: [{ path: 'a.md', size: 1 }],
        stats: { fileCount: 1, totalBytes: 1 },
      }),
    ).toThrow(/files\[0\]\.sha256/);
  });

  it('rejects an invalid scope value', () => {
    expect(() =>
      parseManifest({
        root: '/r',
        cwdBasename: 'r',
        files: [],
        stats: { fileCount: 0, totalBytes: 0 },
        scope: 'remote',
      }),
    ).toThrow(/scope/);
  });

  it('accepts scope and localOnly when valid', () => {
    const manifest = parseManifest({
      root: '/home/user/.claude',
      cwdBasename: '.claude',
      files: [],
      stats: { fileCount: 0, totalBytes: 0 },
      scope: 'global',
      localOnly: true,
    });
    expect(manifest.scope).toBe('global');
    expect(manifest.localOnly).toBe(true);
  });
});
