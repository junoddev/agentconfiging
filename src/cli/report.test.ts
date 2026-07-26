/**
 * CLI-level integration tests for `agentconfiging report`: the in-process
 * action function (runReport) over real fixture trees via scanProject.
 * Pins stdout purity (nothing but one JSON document), the exit-code
 * mapping, --pretty, --global, per-global-dir ScanError isolation, the
 * engine-failure path, and — structurally — that no file content ever
 * reaches stdout (no 'patch'/'content'/'edits' key anywhere in the output
 * graph; fix payloads are summarized as hasFix/fixKind).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { runReport, type ReportOptions } from './report.js';

const repoRoot = process.cwd();
const trees = path.resolve(repoRoot, 'fixtures/trees');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
  version: string;
};

const tmpDirs: string[] = [];
function mkTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-report-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
}

function run(opts: ReportOptions): RunResult {
  const out: string[] = [];
  const err: string[] = [];
  const code = runReport(opts, {
    stdout: (chunk) => void out.push(chunk),
    stderr: (chunk) => void err.push(chunk),
  });
  const stdout = out.join('');
  // Purity: the ENTIRE stdout stream must be one JSON document (plus
  // insignificant whitespace, which JSON.parse alone tolerates).
  const json = JSON.parse(stdout) as Record<string, unknown>;
  return { code, stdout, stderr: err.join(''), json };
}

interface FindingLike {
  id: string;
  severity: string;
  hasFix?: boolean;
  fixKind?: string;
}

/** Keys that would mean file content leaked into the report. */
const BANNED_KEYS = new Set(['patch', 'content', 'edits']);

/** Walk the whole output object graph and collect any banned key names. */
function bannedKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) bannedKeys(item, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (BANNED_KEYS.has(key)) found.push(key);
      bannedKeys(child, found);
    }
  }
  return found;
}

describe('runReport exit codes', () => {
  it('clean tree (negative-plain): exit 0, no agents, no findings', () => {
    const { code, json, stderr } = run({ path: path.join(trees, 'negative-plain') });
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(json['scope']).toBe('project');
    expect(json['localOnly']).toBe(false);
    expect(json['agents']).toEqual([]);
    expect(json['findings']).toEqual([]);
    expect(json['version']).toBe(pkg.version);
    expect(new Date(json['generatedAt'] as string).toISOString()).toBe(json['generatedAt']);
    expect(json['root']).toContain('negative-plain');
    expect(json['stats']).toMatchObject({ fileCount: 0 });
  });

  it('warning tree (multi-runtime): exit 1', () => {
    const { code, json } = run({ path: path.join(trees, 'multi-runtime') });
    expect(code).toBe(1);
    const findings = json['findings'] as FindingLike[];
    expect(findings.some((f) => f.severity === 'warning')).toBe(true);
    expect(findings.some((f) => f.severity === 'error')).toBe(false);
  });

  it('error tree (claude-rich): exit 2 with settings-local-committed', () => {
    const { code, json } = run({ path: path.join(trees, 'claude-rich') });
    expect(code).toBe(2);
    const findings = json['findings'] as FindingLike[];
    expect(findings.map((f) => f.id)).toContain('settings-local-committed');
    expect(findings[0]?.severity).toBe('error'); // sorted: errors first
  });

  it('nonexistent path: exit 3 with structured error JSON and stderr message', () => {
    const { code, json, stderr } = run({ path: path.join(trees, 'does-not-exist') });
    expect(code).toBe(3);
    const error = json['error'] as { name: string; message: string };
    expect(error.name).toBe('Error');
    expect(error.message).toBeTruthy();
    expect(json['findings']).toBeUndefined();
    expect(stderr).toMatch(/^agentconfiging report: /);
  });
});

describe('output shape', () => {
  it('report carries paths/metadata/findings but never file contents', () => {
    const { stdout, json } = run({ path: path.join(trees, 'claude-rich') });
    expect(Object.keys(json).sort()).toEqual([
      'agents',
      'findings',
      'generatedAt',
      'localOnly',
      'root',
      'scope',
      'stats',
      'version',
    ]);
    // No content-bearing key anywhere in the output graph.
    expect(bannedKeys(json)).toEqual([]);
    // The tree's CLAUDE.md body must not leak into the report.
    const claudeMd = fs.readFileSync(path.join(trees, 'claude-rich', 'CLAUDE.md'), 'utf-8');
    const firstLine = claudeMd.split('\n').find((l) => l.trim().length > 0) ?? claudeMd;
    expect(stdout).not.toContain(JSON.stringify(firstLine).slice(1, -1));
  });

  it('summarizes fix payloads as hasFix/fixKind instead of serializing patches', () => {
    const { json } = run({ path: path.join(trees, 'claude-rich') });
    const findings = json['findings'] as FindingLike[];
    const withFix = findings.find((f) => f.id === 'settings-local-committed');
    expect(withFix).toMatchObject({ hasFix: true, fixKind: 'create-file' });
    expect('fix' in (withFix as object)).toBe(false);
    expect(bannedKeys(json)).toEqual([]);
  });

  it('default output is compact single-line JSON; --pretty indents', () => {
    const compact = run({ path: path.join(trees, 'negative-plain') });
    expect(compact.stdout.endsWith('\n')).toBe(true);
    expect(compact.stdout.trimEnd()).not.toContain('\n');

    const pretty = run({ path: path.join(trees, 'negative-plain'), pretty: true });
    expect(pretty.stdout).toContain('\n  "');
    const strip = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'generatedAt'));
    expect(strip(pretty.json)).toEqual(strip(compact.json));
  });

  it('mcp-command-not-on-path fires end-to-end from a real scan when PATH lacks the command', () => {
    // agentconfig-np8.12: the scanner now includes root `.mcp.json`
    // (ADDITIONAL_KNOWN_FILES), so claude-rich's `postgres` server (command
    // `npx`) is checked against the injected env bag. Pin updated on
    // purpose: the old expectation (withEnv findings == without findings)
    // encoded the KNOWN_FILES gap this bead fixed.
    const bin = mkTmpDir();
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n', { mode: 0o755 });
    const withEnv = run({ path: path.join(trees, 'claude-rich'), pathEnv: bin });
    const without = run({ path: path.join(trees, 'claude-rich'), pathEnv: '' });
    expect(withEnv.code).toBe(2);

    const withIds = (withEnv.json['findings'] as FindingLike[]).map((f) => f.id);
    const withoutIds = (without.json['findings'] as FindingLike[]).map((f) => f.id);
    // `npx` is not in the injected PATH dir (only `node` is) → warning.
    // `bus-inspector` (./tools/bus-mcp) is path-form and never checked.
    expect(withIds).toContain('mcp-command-not-on-path-postgres-npx');
    expect(withIds.filter((id) => id.startsWith('mcp-command-not-on-path'))).toHaveLength(1);
    // Empty PATH → no env fact → the check is skipped entirely, and the
    // remaining findings are identical to the env-bag run.
    expect(withoutIds).not.toContain('mcp-command-not-on-path-postgres-npx');
    expect(withIds.filter((id) => !id.startsWith('mcp-command-not-on-path'))).toEqual(withoutIds);
  });
});

describe('--global', () => {
  it('wraps project + per-dir global reports; global entries carry localOnly: true', () => {
    const home = mkTmpDir();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"model":"claude-opus-4-5"}\n');
    const { code, json } = run({
      path: path.join(trees, 'negative-plain'),
      global: true,
      homeDir: home,
    });
    expect(code).toBe(0);
    expect(Object.keys(json).sort()).toEqual(['generatedAt', 'global', 'project', 'version']);
    const project = json['project'] as Record<string, unknown>;
    expect(project['scope']).toBe('project');
    expect(project['localOnly']).toBe(false);
    const globals = json['global'] as Record<string, unknown>[];
    expect(globals).toHaveLength(1);
    expect(globals[0]?.['scope']).toBe('global');
    expect(globals[0]?.['localOnly']).toBe(true);
    expect(String(globals[0]?.['root'])).toMatch(/\.claude$/);
  });

  it('never leaks global file contents: secret in settings env stays off stdout', () => {
    // Reviewer regression: a stale model id makes stale-model-ref emit a fix
    // whose patch is the COMPLETE settings.json — including the secret env
    // value. The serializer must summarize the fix, not print it.
    const home = mkTmpDir();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify(
        {
          model: 'claude-3-opus-20240229',
          env: { MY_API_KEY: 'sk-SUPERSECRET-abc123' },
        },
        null,
        2,
      ),
    );
    const { code, stdout, json } = run({
      path: path.join(trees, 'negative-plain'),
      global: true,
      homeDir: home,
    });
    expect(stdout).not.toContain('sk-SUPERSECRET');
    expect(bannedKeys(json)).toEqual([]);
    const globals = json['global'] as { findings: FindingLike[] }[];
    const stale = globals[0]?.findings.find((f) => f.id.startsWith('stale-model-ref'));
    expect(stale).toMatchObject({ severity: 'warning', hasFix: true, fixKind: 'replace-file' });
    expect(code).toBe(1); // the global warning drives the exit code
  });

  it('isolates a ScanError to its global dir instead of killing the report', () => {
    const home = mkTmpDir();
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"model":"claude-opus-4-5"}\n');
    // 250 files trips CAPS.maxFiles (200) for the .cursor dir only.
    const fat = path.join(home, '.cursor');
    fs.mkdirSync(fat);
    for (let i = 0; i < 250; i += 1) fs.writeFileSync(path.join(fat, `r${i}.md`), 'x\n');

    const { code, json, stderr } = run({
      path: path.join(trees, 'negative-plain'),
      global: true,
      homeDir: home,
    });
    const globals = json['global'] as Record<string, unknown>[];
    expect(globals).toHaveLength(2);

    const claude = globals.find((g) => String(g['root']).endsWith('.claude'));
    expect(claude).toBeDefined();
    expect(claude?.['error']).toBeUndefined();
    expect(claude?.['findings']).toBeDefined();

    const cursor = globals.find((g) => String(g['root']).endsWith('.cursor'));
    expect(cursor).toMatchObject({
      scope: 'global',
      localOnly: true,
      error: { name: 'ScanError', code: 'E_TOO_MANY_FILES' },
    });
    expect(cursor?.['findings']).toBeUndefined();

    // Exit code comes from surviving findings only; diagnostics on stderr.
    expect(code).toBe(0);
    expect(stderr).toContain('skipping global dir');
    expect(stderr).toContain('.cursor');
  });
});

describe('built CLI smoke test', () => {
  const builtCli = path.join(repoRoot, 'dist/cli/index.js');
  const exists = fs.existsSync(builtCli);

  it.skipIf(!exists)('dist/cli/index.js report emits pure JSON', () => {
    const stdout = execFileSync(
      process.execPath,
      [builtCli, 'report', path.join(trees, 'negative-plain')],
      { encoding: 'utf-8', timeout: 5000 },
    );
    const json = JSON.parse(stdout) as Record<string, unknown>;
    expect(json['scope']).toBe('project');
    expect(json['findings']).toEqual([]);
  });

  it.skipIf(!exists)('dist/cli/index.js exits 64 on usage errors with empty stdout', () => {
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync(process.execPath, [builtCli, 'report', '--nope'], {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 0;
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? '';
    }
    expect(status).toBe(64);
    expect(stdout).toBe('');
    expect(stderr).toContain("unknown option '--nope'");
    expect(stderr).toContain('Usage: agentconfiging report');
  });
});
