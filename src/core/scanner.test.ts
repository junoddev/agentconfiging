import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADDITIONAL_KNOWN_FILES,
  CAPS,
  KNOWN_FILES,
  ScanError,
  scanGlobal,
  scanProject,
} from './scanner.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  // realpathSync: os.tmpdir() is itself a symlink on macOS (/var -> /private/var)
  // and the scanner resolves roots to their real path.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-scanner-')));
  tempDirs.push(dir);
  return dir;
}

function write(root: string, relPath: string, content: string | Buffer): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('scanProject', () => {
  it('collects known root files and allowed files under known dirs, nothing else', () => {
    const root = makeTempDir();
    write(root, 'CLAUDE.md', '# hi\n');
    write(root, '.cursorrules', 'be nice\n');
    write(root, '.claude/settings.json', '{}\n');
    write(root, '.claude/rules/style.md', 'rules\n');
    write(root, 'README.md', 'not agent config\n'); // root file, not in KNOWN_FILES
    write(root, '.claude/logo.png', 'x'); // under known dir, ext not allowed
    write(root, 'src/index.ts', 'code\n'); // outside known dirs

    const manifest = scanProject(root);
    expect(manifest.files.map((f) => f.path)).toEqual([
      '.claude/rules/style.md',
      '.claude/settings.json',
      '.cursorrules',
      'CLAUDE.md',
    ]);
    expect(manifest.root).toBe(root);
    expect(manifest.cwdBasename).toBe(path.basename(root));
    expect(manifest.scope).toBe('project');
    expect(manifest.localOnly).toBe(false);
    expect(manifest.stats.fileCount).toBe(4);
  });

  it('collects ADDITIONAL_KNOWN_FILES at their exact paths, with content (agentconfig-np8.12)', () => {
    const root = makeTempDir();
    write(root, '.mcp.json', '{"mcpServers":{}}\n');
    write(root, 'codex.toml', 'model = "gpt-5-codex"\n');
    write(root, 'opencode.json', '{"model":"anthropic/claude"}\n');
    write(root, '.github/copilot-instructions.md', '# copilot\n');
    // Exact-path semantics: nested lookalikes stay excluded.
    write(root, 'sub/.mcp.json', '{"mcpServers":{}}\n');
    write(root, 'packages/app/codex.toml', 'nested\n');

    const manifest = scanProject(root);
    expect(manifest.files.map((f) => f.path)).toEqual([
      '.github/copilot-instructions.md',
      '.mcp.json',
      'codex.toml',
      'opencode.json',
    ]);
    for (const file of manifest.files) {
      expect(file.content).toBeTruthy();
      expect(file.truncated).toBeUndefined();
    }
  });

  it('collects .github/instructions/*.instructions.md, not the rest of .github (agentconfig-np8.13)', () => {
    const root = makeTempDir();
    write(root, '.github/instructions/api.instructions.md', '# api rules\n');
    write(root, '.github/instructions/db.instructions.md', '# db rules\n');
    // Must NOT be over-collected:
    write(root, '.github/instructions/readme.md', 'not an instructions file\n');
    write(root, '.github/workflows/ci.yml', 'on: push\n');
    write(root, '.github/random.md', 'arbitrary .github markdown\n');
    write(root, '.github/ISSUE_TEMPLATE/bug.md', 'bug template\n');

    const manifest = scanProject(root);
    expect(manifest.files.map((f) => f.path)).toEqual([
      '.github/instructions/api.instructions.md',
      '.github/instructions/db.instructions.md',
    ]);
    for (const file of manifest.files) {
      expect(file.content).toBeTruthy();
      expect(file.truncated).toBeUndefined();
    }
  });

  it('keeps the ported tables byte-identical (additions live in ADDITIONAL_KNOWN_FILES only)', () => {
    // KNOWN_FILES is lifted verbatim from markdowning's scanner and must
    // never absorb the documented additions (agentconfig-np8.12).
    expect(KNOWN_FILES).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      'GEMINI.md',
      '.cursorrules',
      '.aider.conf.yml',
      '.aiderignore',
      '.continuerules',
      'COPILOT.md',
    ]);
    for (const added of ADDITIONAL_KNOWN_FILES) {
      expect(KNOWN_FILES).not.toContain(added);
    }
  });

  it('records size, sha256 and content for small text files', () => {
    const root = makeTempDir();
    const body = '# Project rules\nUse tabs.\n';
    write(root, 'CLAUDE.md', body);

    const file = scanProject(root).files[0];
    expect(file?.size).toBe(Buffer.byteLength(body));
    expect(file?.sha256).toBe(crypto.createHash('sha256').update(body).digest('hex'));
    expect(file?.content).toBe(body);
    expect(file?.truncated).toBeUndefined();
  });

  it('never follows symlinks, even when they point outside the root', () => {
    const outside = makeTempDir();
    write(outside, 'secret.md', 'do not read\n');
    const root = makeTempDir();
    write(root, '.claude/settings.json', '{}\n');
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, '.claude/escape.md'));
    fs.symlinkSync(outside, path.join(root, '.claude/escape-dir'));

    const manifest = scanProject(root);
    expect(manifest.files.map((f) => f.path)).toEqual(['.claude/settings.json']);
    expect(manifest.stats.skipped).toBeGreaterThanOrEqual(2);
  });

  it('withholds content of binary files (NUL byte) but keeps size and sha256', () => {
    const root = makeTempDir();
    const blob = Buffer.from([0x68, 0x69, 0x00, 0xff, 0x01]);
    write(root, '.claude/blob.md', blob);

    const file = scanProject(root).files[0];
    expect(file?.path).toBe('.claude/blob.md');
    expect(file?.size).toBe(blob.length);
    expect(file?.sha256).toBe(crypto.createHash('sha256').update(blob).digest('hex'));
    expect(file?.content).toBeUndefined();
    expect(file?.truncated).toBe(true);
  });

  it('prunes SKIP_DIRS even inside known dirs', () => {
    const root = makeTempDir();
    write(root, '.claude/rules/ok.md', 'keep\n');
    write(root, '.claude/node_modules/dep.md', 'skip\n');
    write(root, 'node_modules/pkg/CLAUDE.md', 'skip\n');

    const manifest = scanProject(root);
    expect(manifest.files.map((f) => f.path)).toEqual(['.claude/rules/ok.md']);
    expect(manifest.stats.skipped).toBeGreaterThanOrEqual(2);
  });

  it('withholds content over the per-file inlining cap (64 KiB)', () => {
    const root = makeTempDir();
    const big = 'a'.repeat(CAPS.maxFileBytes + 1);
    write(root, '.claude/big.md', big);

    const file = scanProject(root).files[0];
    expect(file?.size).toBe(CAPS.maxFileBytes + 1);
    expect(file?.content).toBeUndefined();
    expect(file?.truncated).toBe(true);
    expect(file?.sha256).toBe(crypto.createHash('sha256').update(big).digest('hex'));
  });

  it('orders files by plain codepoint compare, independent of locale collation', () => {
    const root = makeTempDir();
    for (const name of ['B.md', 'a.md', 'Z.md', 'ä.md', '10.md', '_x.md']) {
      write(root, `.claude/${name}`, 'x\n');
    }
    // NFC-normalize: some filesystems store 'ä' decomposed.
    const paths = scanProject(root).files.map((f) => f.path.normalize('NFC'));
    expect(paths).toEqual([
      '.claude/10.md',
      '.claude/B.md',
      '.claude/Z.md',
      '.claude/_x.md',
      '.claude/a.md',
      '.claude/ä.md',
    ]);
  });

  it('resolves a symlinked root once and scans the real directory', () => {
    const real = makeTempDir();
    write(real, 'CLAUDE.md', '# via symlink\n');
    const holder = makeTempDir();
    const link = path.join(holder, 'my-project');
    fs.symlinkSync(real, link);

    const manifest = scanProject(link);
    expect(manifest.root).toBe(real);
    expect(manifest.cwdBasename).toBe('my-project');
    expect(manifest.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
  });

  it('throws E_TOO_MANY_FILES over the file cap', () => {
    const root = makeTempDir();
    for (let i = 0; i <= CAPS.maxFiles; i += 1) {
      write(root, `.claude/rules/r${String(i).padStart(3, '0')}.md`, 'x\n');
    }
    const err = (() => {
      try {
        scanProject(root);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ScanError);
    expect((err as ScanError).code).toBe('E_TOO_MANY_FILES');
  });

  it('throws E_TOO_LARGE over the total byte cap', () => {
    const root = makeTempDir();
    const chunk = 'b'.repeat(CAPS.maxFileBytes);
    const count = Math.ceil(CAPS.maxTotalBytes / CAPS.maxFileBytes) + 1;
    for (let i = 0; i < count; i += 1) {
      write(root, `.claude/rules/big${String(i).padStart(2, '0')}.md`, chunk);
    }
    const err = (() => {
      try {
        scanProject(root);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ScanError);
    expect((err as ScanError).code).toBe('E_TOO_LARGE');
  });

  it('throws E_TOO_LARGE from stat size BEFORE reading a budget-busting file', () => {
    const root = makeTempDir();
    write(root, '.claude/huge.md', 'c'.repeat(CAPS.maxTotalBytes + 1));

    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      const err = (() => {
        try {
          scanProject(root);
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(ScanError);
      expect((err as ScanError).code).toBe('E_TOO_LARGE');
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  it('smoke: scans this repository', () => {
    // vitest runs from the repo root; this repo has CLAUDE.md and .claude/.
    const manifest = scanProject(process.cwd());
    const paths = manifest.files.map((f) => f.path);
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('.claude/settings.json');
    expect(manifest.scope).toBe('project');
    expect(manifest.localOnly).toBe(false);
  });
});

describe('scanGlobal', () => {
  it('builds one local-only manifest per existing global config dir', () => {
    const home = makeTempDir();
    write(home, '.claude/CLAUDE.md', '# global rules\n');
    write(home, '.claude/settings.json', '{}\n');
    write(home, '.codex/config.toml', 'model = "gpt-5-codex"\n');
    write(home, '.codex/AGENTS.md', '# global guidance\n');

    const manifests = scanGlobal(home);
    expect(manifests.map((m) => m.cwdBasename)).toEqual(['.claude', '.codex']);

    const claude = manifests[0];
    expect(claude?.root).toBe(fs.realpathSync(path.join(home, '.claude')));
    expect(claude?.scope).toBe('global');
    expect(claude?.localOnly).toBe(true);
    expect(claude?.files.map((f) => f.path)).toEqual(['CLAUDE.md', 'settings.json']);

    const codex = manifests[1];
    expect(codex?.files.map((f) => f.path)).toEqual(['AGENTS.md', 'config.toml']);
    expect(codex?.localOnly).toBe(true);
  });

  it('prunes runtime-state dirs like ~/.claude/projects', () => {
    const home = makeTempDir();
    write(home, '.claude/CLAUDE.md', '# global\n');
    write(home, '.claude/projects/-home-user-app/session.md', 'history\n');
    write(home, '.claude/todos/todo.json', '[]\n');

    const manifests = scanGlobal(home);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
    expect(manifests[0]?.stats.skipped).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty list for a home with no agent config', () => {
    const home = makeTempDir();
    write(home, 'notes.md', 'nothing agenty\n');
    expect(scanGlobal(home)).toEqual([]);
  });
});
