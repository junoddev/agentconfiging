import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { collectPathCommands } from './path-env.js';

const tmpDirs: string[] = [];
function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-path-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('collectPathCommands', () => {
  it('collects executable names across PATH entries, deduped and sorted', () => {
    const a = mkTmpDir();
    const b = mkTmpDir();
    fs.writeFileSync(path.join(a, 'zeta'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(a, 'alpha'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(b, 'alpha'), '#!/bin/sh\n', { mode: 0o755 });
    expect(collectPathCommands([a, b].join(path.delimiter))).toEqual(['alpha', 'zeta']);
  });

  it.runIf(process.platform !== 'win32')('excludes non-executable files and directories', () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'runnable'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'data.txt'), 'x', { mode: 0o644 });
    fs.mkdirSync(path.join(dir, 'subdir'));
    expect(collectPathCommands(dir)).toEqual(['runnable']);
  });

  it('tolerates missing/unreadable directories and empty PATH', () => {
    const dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    const missing = path.join(dir, 'does-not-exist');
    expect(collectPathCommands([missing, dir].join(path.delimiter))).toEqual(['tool']);
    expect(collectPathCommands('')).toEqual([]);
    expect(collectPathCommands(undefined)).toEqual([]);
  });
});
