/**
 * Unit tests for the GIT PANEL pure layer (bead ngs.1): ref/path/message
 * validation (the injection defenses), the porcelain-v2 / log / branch parsers,
 * and exec-error classification. Plus ONE real-temp-repo integration test that
 * runs the DEFAULT exec (a real `git`) against a repo created + destroyed under
 * os.tmpdir — proving cwd-scoping + parsing against genuine git output. That test
 * skips cleanly when git is unavailable.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  classifyError,
  defaultGitExec,
  isValidMessage,
  isValidRef,
  isValidRepoPath,
  parseBranches,
  parseLog,
  parseStatus,
  validateFiles,
} from './git.js';

const repoRoot = '/home/user/project';

describe('isValidRef', () => {
  it('accepts ordinary branch names', () => {
    for (const ok of ['main', 'feature/x', 'release-1.2', 'a_b', 'v1.0.0']) {
      expect(isValidRef(ok)).toBe(true);
    }
  });
  it('rejects flag-injection, metachars, and ref-format traps', () => {
    for (const bad of [
      '',
      '-x',
      '--force',
      'foo bar',
      'foo;rm',
      'foo$(id)',
      'foo`id`',
      'foo|bar',
      'a..b',
      'a//b',
      '/lead',
      'trail/',
      '.hidden',
      'name.lock',
      'ref@{0}',
      'foo\nbar',
    ]) {
      expect(isValidRef(bad)).toBe(false);
    }
  });
});

describe('isValidRepoPath', () => {
  it('accepts in-repo relative paths', () => {
    for (const ok of ['a.ts', 'src/a.ts', 'src/nested/dir/file.txt']) {
      expect(isValidRepoPath(repoRoot, ok)).toBe(true);
    }
  });
  it('rejects traversal, absolute, leading-dash, and control chars', () => {
    for (const bad of ['../escape', '../../etc/passwd', '/etc/passwd', '-rf', 'a\0b', '']) {
      expect(isValidRepoPath(repoRoot, bad)).toBe(false);
    }
  });
  it('rejects a path that resolves outside the repo even without a leading ../', () => {
    expect(isValidRepoPath(repoRoot, 'src/../../../etc/passwd')).toBe(false);
  });
});

describe('validateFiles', () => {
  it('validates + de-dupes a files array', () => {
    expect(validateFiles(repoRoot, ['a.ts', 'a.ts', 'b.ts'])).toEqual(['a.ts', 'b.ts']);
  });
  it('rejects empty, non-array, or any-invalid list', () => {
    expect(validateFiles(repoRoot, [])).toBeUndefined();
    expect(validateFiles(repoRoot, 'a.ts')).toBeUndefined();
    expect(validateFiles(repoRoot, ['a.ts', '../b'])).toBeUndefined();
  });
});

describe('isValidMessage', () => {
  it('accepts a non-empty message including shell-ish text (it is inert)', () => {
    expect(isValidMessage('feat: x\n\n; $(id) `whoami`')).toBe(true);
  });
  it('rejects empty/blank/non-string', () => {
    expect(isValidMessage('')).toBe(false);
    expect(isValidMessage('   ')).toBe(false);
    expect(isValidMessage(5)).toBe(false);
  });
});

describe('parseStatus', () => {
  it('parses branch, ahead/behind, and grouped changes', () => {
    const out = parseStatus(
      [
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +3 -2',
        '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
        '1 .M N... 100644 100644 100644 ccc ddd wt.ts',
        '2 R. N... 100644 100644 100644 hhh iii R100 new.ts\told.ts',
        '? untracked.ts',
        '',
      ].join('\n'),
    );
    expect(out).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 3, behind: 2 });
    expect(out.staged).toEqual([
      { path: 'staged.ts', status: 'M' },
      { path: 'new.ts', status: 'R', orig: 'old.ts' },
    ]);
    expect(out.unstaged).toEqual([{ path: 'wt.ts', status: 'M' }]);
    expect(out.untracked).toEqual(['untracked.ts']);
  });
  it('marks a detached HEAD', () => {
    const out = parseStatus('# branch.head (detached)\n');
    expect(out.detached).toBe(true);
    expect(out.branch).toBe('');
  });
});

describe('parseLog', () => {
  it('parses delimiter-framed records into typed commits', () => {
    const raw = 'h1\x1fAda\x1f2026-01-01\x1ffeat: one\x1eh2\x1fBo\x1f2026-01-02\x1ffix: two\x1e';
    expect(parseLog(raw)).toEqual([
      { hash: 'h1', author: 'Ada', date: '2026-01-01', subject: 'feat: one' },
      { hash: 'h2', author: 'Bo', date: '2026-01-02', subject: 'fix: two' },
    ]);
  });
  it('returns [] for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });
});

describe('parseBranches', () => {
  it('parses the list + current, skipping the detached placeholder', () => {
    expect(parseBranches('* main\n  dev\n')).toEqual([
      { name: 'main', current: true },
      { name: 'dev', current: false },
    ]);
    expect(parseBranches('* (HEAD detached at abc)\n  main\n')).toEqual([
      { name: 'main', current: false },
    ]);
  });
});

describe('classifyError', () => {
  it('maps ENOENT → absent, killed → timeout, not-a-repo → not-repo', () => {
    expect(classifyError(Object.assign(new Error(), { code: 'ENOENT' })).kind).toBe('absent');
    expect(classifyError(Object.assign(new Error(), { killed: true })).kind).toBe('timeout');
    expect(
      classifyError(Object.assign(new Error(), { stderr: 'fatal: not a git repository' })).kind,
    ).toBe('not-repo');
  });
  it('maps any other failure to a typed error with git’s message', () => {
    const f = classifyError(Object.assign(new Error(), { stderr: 'fatal: bad revision\n' }));
    expect(f).toEqual({ kind: 'error', message: 'fatal: bad revision' });
  });
});

// ── Real-git integration (temp repo, created + destroyed) ────────────────────

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitAvailable();
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-gitreal-'));
afterAll(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

describe.runIf(HAS_GIT)('defaultGitExec against a real temp repo', () => {
  it('runs status/log confined to cwd and parses genuine git output', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, 'repo-')));
    const run = (args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: 'ignore', env: { ...process.env } });
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export const a = 1;\n');
    run(['add', 'tracked.ts']);
    run(['commit', '-q', '-m', 'feat: initial']);
    fs.writeFileSync(path.join(repo, 'untracked.ts'), 'x\n');
    fs.writeFileSync(path.join(repo, 'tracked.ts'), 'export const a = 2;\n');

    const status = await defaultGitExec(
      ['-c', 'core.quotePath=false', 'status', '--porcelain=v2', '--branch'],
      { cwd: repo, timeoutMs: 10_000 },
    );
    const parsed = parseStatus(status.stdout);
    expect(parsed.unstaged.some((c) => c.path === 'tracked.ts')).toBe(true);
    expect(parsed.untracked).toContain('untracked.ts');

    const log = await defaultGitExec(['log', '--format=%H\x1f%an\x1f%aI\x1f%s\x1e', '-n', '50'], {
      cwd: repo,
      timeoutMs: 10_000,
    });
    const commits = parseLog(log.stdout);
    expect(commits[0]?.subject).toBe('feat: initial');
  });

  it('commits a message piped on STDIN via -F - (message with metachars stays inert)', async () => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(tmpBase, 'repo-')));
    const run = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    run(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repo, 'f.ts'), '1\n');
    run(['add', 'f.ts']);
    const message = 'feat: safe\n\nbody ; $(touch PWNED) `id`';
    await defaultGitExec(['commit', '-F', '-'], { cwd: repo, timeoutMs: 10_000, input: message });
    // The subject is recorded literally and NO command executed (no PWNED file).
    const log = await defaultGitExec(['log', '--format=%s\x1e', '-n', '1'], {
      cwd: repo,
      timeoutMs: 10_000,
    });
    expect(log.stdout).toContain('feat: safe');
    expect(fs.existsSync(path.join(repo, 'PWNED'))).toBe(false);
  });
});
