import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_DIRS,
  DiscoveryError,
  discoverProjects,
} from './discovery.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  // realpathSync: os.tmpdir() is itself a symlink on macOS (/var -> /private/var)
  // and discovery resolves roots to their real path.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-discovery-')));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, relPath: string, content = 'x\n'): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function mkdir(root: string, relPath: string): void {
  fs.mkdirSync(path.join(root, relPath), { recursive: true });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('discoverProjects', () => {
  it('returns no hits for an empty tree', () => {
    const root = makeTempDir();
    mkdir(root, 'a/b');
    write(root, 'a/readme.txt');

    const { hits, stats } = discoverProjects(root);
    expect(hits).toEqual([]);
    expect(stats.truncated).toBe(false);
    expect(stats.dirsVisited).toBe(3); // root, a, a/b
  });

  it('finds nested projects at varying depths, parent and child both reported', () => {
    const root = makeTempDir();
    write(root, 'CLAUDE.md');
    write(root, 'packages/app/.cursorrules');
    mkdir(root, 'packages/app/.cursor');
    write(root, 'deep/x/y/GEMINI.md');

    const { hits } = discoverProjects(root);
    expect(hits).toEqual([
      { root, markers: ['CLAUDE.md'], runtimes: ['claude-code'] },
      {
        root: path.join(root, 'deep/x/y'),
        markers: ['GEMINI.md'],
        runtimes: ['gemini-cli'],
      },
      {
        root: path.join(root, 'packages/app'),
        markers: ['.cursor', '.cursorrules'],
        runtimes: ['cursor'],
      },
    ]);
    // Parent-child relation is expressed by path prefix alone.
    expect(hits[1]?.root.startsWith(root + path.sep)).toBe(true);
  });

  it('prunes SKIP_DIRS: a decoy .cursorrules inside node_modules never hits', () => {
    const root = makeTempDir();
    write(root, 'node_modules/some-pkg/.cursorrules');
    write(root, 'dist/CLAUDE.md');

    const { hits, stats } = discoverProjects(root);
    expect(hits).toEqual([]);
    expect(stats.skipped).toBeGreaterThanOrEqual(2);
  });

  it('never follows symlinks: cycles terminate and outside targets stay invisible', () => {
    const outside = makeTempDir();
    write(outside, 'CLAUDE.md');

    const root = makeTempDir();
    mkdir(root, 'a');
    fs.symlinkSync(root, path.join(root, 'a/loop')); // cycle back to the walk root
    fs.symlinkSync(outside, path.join(root, 'a/escape')); // points out of scope

    const { hits, stats } = discoverProjects(root);
    expect(hits).toEqual([]);
    expect(stats.skipped).toBeGreaterThanOrEqual(2);
    expect(stats.truncated).toBe(false);
  });

  it('a symlink whose name matches a marker does not count', () => {
    const outside = makeTempDir();
    write(outside, 'real.md');

    const root = makeTempDir();
    fs.symlinkSync(path.join(outside, 'real.md'), path.join(root, 'CLAUDE.md'));
    fs.symlinkSync(outside, path.join(root, '.claude'));

    const { hits } = discoverProjects(root);
    expect(hits).toEqual([]);
  });

  it('resolves a symlinked walk root once and reports real paths', () => {
    const real = makeTempDir();
    write(real, 'CLAUDE.md');
    const holder = makeTempDir();
    const link = path.join(holder, 'projects');
    fs.symlinkSync(real, link);

    const { hits } = discoverProjects(link);
    expect(hits).toEqual([{ root: real, markers: ['CLAUDE.md'], runtimes: ['claude-code'] }]);
  });

  it('respects the depth bound', () => {
    const root = makeTempDir();
    write(root, 'a/b/c/CLAUDE.md'); // hit at depth 3

    const shallow = discoverProjects(root, { maxDepth: 2 });
    expect(shallow.hits).toEqual([]);
    expect(shallow.stats.skipped).toBeGreaterThanOrEqual(1); // depth-pruned 'c'

    const deep = discoverProjects(root, { maxDepth: 3 });
    expect(deep.hits.map((h) => h.root)).toEqual([path.join(root, 'a/b/c')]);
  });

  it('maxDepth 0 still inspects the root itself', () => {
    const root = makeTempDir();
    write(root, 'AGENTS.md');
    write(root, 'sub/CLAUDE.md');

    const { hits } = discoverProjects(root, { maxDepth: 0 });
    expect(hits).toEqual([{ root, markers: ['AGENTS.md'], runtimes: ['codex'] }]);
  });

  it('caps total directories visited and sets truncated', () => {
    const root = makeTempDir();
    for (let i = 0; i < 20; i += 1) {
      write(root, `d${String(i).padStart(2, '0')}/CLAUDE.md`);
    }

    const { hits, stats } = discoverProjects(root, { maxDirs: 5 });
    expect(stats.truncated).toBe(true);
    expect(stats.dirsVisited).toBe(5);
    expect(hits).toHaveLength(4); // root readdir + 4 child dirs before the cap
  });

  it('a multi-runtime directory yields one hit with all runtimes', () => {
    const root = makeTempDir();
    write(root, 'CLAUDE.md');
    write(root, 'AGENTS.md');
    write(root, '.cursorrules');
    write(root, 'opencode.json');
    mkdir(root, '.gemini');
    write(root, '.github/copilot-instructions.md');

    const { hits } = discoverProjects(root);
    expect(hits).toEqual([
      {
        root,
        markers: [
          '.cursorrules',
          '.gemini',
          '.github/copilot-instructions.md',
          'AGENTS.md',
          'CLAUDE.md',
          'opencode.json',
        ],
        runtimes: ['claude-code', 'codex', 'copilot', 'cursor', 'gemini-cli', 'opencode'],
      },
    ]);
  });

  it('probes .github shallowly: copilot dir hits, workflows-only does not', () => {
    const root = makeTempDir();
    write(root, 'with/.github/copilot/config.yml');
    write(root, 'without/.github/workflows/ci.yml');

    const { hits } = discoverProjects(root);
    expect(hits).toEqual([
      {
        root: path.join(root, 'with'),
        markers: ['.github/copilot'],
        runtimes: ['copilot'],
      },
    ]);
  });

  it('does not recurse into marker dirs: config trees are not nested projects', () => {
    const root = makeTempDir();
    write(root, '.claude/vendored/CLAUDE.md');

    const { hits } = discoverProjects(root);
    expect(hits).toEqual([{ root, markers: ['.claude'], runtimes: ['claude-code'] }]);
  });

  it('throws typed DiscoveryErrors for a missing or non-directory root', () => {
    const root = makeTempDir();
    write(root, 'file.txt');

    const codeOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
        return undefined;
      } catch (err) {
        expect(err).toBeInstanceOf(DiscoveryError);
        return (err as DiscoveryError).code;
      }
    };
    expect(codeOf(() => discoverProjects(path.join(root, 'nope')))).toBe('E_ROOT_NOT_FOUND');
    expect(codeOf(() => discoverProjects(path.join(root, 'file.txt')))).toBe('E_ROOT_NOT_DIR');
  });

  it('exposes sane defaults', () => {
    expect(DEFAULT_MAX_DEPTH).toBe(6);
    expect(DEFAULT_MAX_DIRS).toBe(10_000);
  });

  it('smoke: finds this repository root with claude-code markers', () => {
    // vitest runs from the repo root; this repo has CLAUDE.md and .claude/.
    const cwd = fs.realpathSync(process.cwd());
    const { hits, stats } = discoverProjects(cwd, { maxDepth: 1 });
    const rootHit = hits.find((h) => h.root === cwd);
    expect(rootHit).toBeDefined();
    expect(rootHit?.markers).toContain('CLAUDE.md');
    expect(rootHit?.markers).toContain('.claude');
    expect(rootHit?.runtimes).toContain('claude-code');
    expect(stats.truncated).toBe(false);
  });
});
