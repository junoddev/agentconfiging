/**
 * Unit tests for the shared global-scan composition (src/core/global.ts,
 * agentconfig-71h.1): multi-dir composition over a fake home, per-dir
 * ScanError isolation (one oversized dir must not kill its siblings),
 * GLOBAL_SKIP_DIRS hygiene for cache/paste-cache, and the content-free
 * contract — findings never carry `fix` (patches can embed secrets),
 * only hasFix/fixKind.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGlobalEntries, type GlobalEntry, type GlobalEntryError } from './global.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  // realpathSync: os.tmpdir() is itself a symlink on macOS (/var -> /private/var)
  // and the scanner resolves roots to their real path.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-global-')));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function ok(entry: GlobalEntry | GlobalEntryError): GlobalEntry {
  expect('error' in entry).toBe(false);
  return entry as GlobalEntry;
}

describe('buildGlobalEntries', () => {
  it('composes one entry per existing global dir with agents/findings/stats', () => {
    const home = makeTempDir();
    write(home, '.claude/settings.json', '{"model":"claude-opus-4-5"}\n');
    write(home, '.claude/CLAUDE.md', '# global guidance\n');
    write(home, '.codex/config.toml', 'model = "gpt-5-codex"\n');

    const entries = buildGlobalEntries(home);
    expect(entries).toHaveLength(2);

    const claude = ok(entries.find((e) => e.dir === '.claude') as GlobalEntry);
    expect(claude.root).toBe(path.join(home, '.claude'));
    expect(claude.agents.map((a) => a.kind)).toContain('claude-code');
    expect(claude.stats.fileCount).toBe(2);
    expect(Array.isArray(claude.findings)).toBe(true);

    const codex = ok(entries.find((e) => e.dir === '.codex') as GlobalEntry);
    expect(codex.root).toBe(path.join(home, '.codex'));
    expect(codex.agents.map((a) => a.kind)).toContain('codex');
    expect(codex.stats.fileCount).toBe(1);
  });

  it('never serializes fix payloads: a secret in settings.json stays out of the entries', () => {
    // A stale model id makes stale-model-ref emit a fix whose patch is the
    // COMPLETE settings.json — including the secret env value. Entries must
    // summarize the fix as hasFix/fixKind, never carry it.
    const home = makeTempDir();
    write(
      home,
      '.claude/settings.json',
      JSON.stringify({
        model: 'claude-3-opus-20240229',
        env: { MY_API_KEY: 'sk-SUPERSECRET-abc123' },
      }),
    );

    const entries = buildGlobalEntries(home);
    const claude = ok(entries[0] as GlobalEntry);
    const stale = claude.findings.find((f) => f.id.startsWith('stale-model-ref'));
    expect(stale).toMatchObject({ hasFix: true, fixKind: 'replace-file' });
    expect(stale && 'fix' in stale).toBe(false);
    expect(JSON.stringify(entries)).not.toContain('sk-SUPERSECRET');
  });

  it('isolates a ScanError to its dir; siblings still report', () => {
    const home = makeTempDir();
    write(home, '.claude/settings.json', '{"model":"claude-opus-4-5"}\n');
    // 250 files trips CAPS.maxFiles (200) for the .cursor dir only.
    for (let i = 0; i < 250; i += 1) write(home, `.cursor/r${i}.md`, 'x\n');

    const entries = buildGlobalEntries(home);
    expect(entries).toHaveLength(2);

    const claude = ok(entries.find((e) => e.dir === '.claude') as GlobalEntry);
    expect(claude.agents.length).toBeGreaterThan(0);

    const cursor = entries.find((e) => e.dir === '.cursor') as GlobalEntryError;
    expect(cursor).toMatchObject({
      root: path.join(home, '.cursor'),
      dir: '.cursor',
      error: { name: 'ScanError', code: 'E_TOO_MANY_FILES' },
    });
    expect('findings' in cursor).toBe(false);
  });

  it('prunes cache/ and paste-cache/ runtime junk from global dirs', () => {
    const home = makeTempDir();
    write(home, '.claude/settings.json', '{"model":"claude-opus-4-5"}\n');
    write(home, '.claude/cache/changelog.md', '# changelog junk\n');
    write(home, '.claude/paste-cache/paste-1.txt', 'pasted junk\n');

    const entries = buildGlobalEntries(home);
    const claude = ok(entries[0] as GlobalEntry);
    expect(claude.stats.fileCount).toBe(1);
    const agentFiles = claude.agents.flatMap((a) => a.files);
    expect(agentFiles).toEqual(['settings.json']);
  });
});
