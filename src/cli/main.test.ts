import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaunchOptions } from './launch.js';
import { EX_USAGE, runCli, type CliDeps } from './main.js';
import { REPORT_HELP } from './report.js';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(argv: string[], deps?: CliDeps): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    argv,
    {
      stdout: (chunk) => void out.push(chunk),
      stderr: (chunk) => void err.push(chunk),
    },
    deps,
  );
  return { code, stdout: out.join(''), stderr: err.join('') };
}

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-main-'));
  tempDirs.push(dir);
  return dir;
}

describe('runCli usage errors (EX_USAGE = 64, stderr only)', () => {
  it('unknown command exits 64 with message + usage on stderr, empty stdout', async () => {
    const launch = vi.fn(async () => 0);
    const { code, stdout, stderr } = await cli(['frobnicate'], { launch });
    expect(code).toBe(EX_USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('frobnicate');
    expect(stderr).toContain('Usage:');
    expect(launch).not.toHaveBeenCalled();
  });

  it('unknown report flag exits 64, distinct from the warnings-found exit 1', async () => {
    const { code, stdout, stderr } = await cli(['report', '--nope']);
    expect(code).toBe(EX_USAGE);
    expect(code).not.toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain("unknown option '--nope'");
    expect(stderr).toContain('Usage: agentconfiging report');
  });

  it('extra report positional exits 64', async () => {
    const { code, stdout } = await cli(['report', 'a', 'b']);
    expect(code).toBe(EX_USAGE);
    expect(stdout).toBe('');
  });

  it('unknown launch option exits 64', async () => {
    const launch = vi.fn(async () => 0);
    const { code } = await cli(['--frobnicate'], { launch });
    expect(code).toBe(EX_USAGE);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('runCli report --help', () => {
  it('prints the canonical help (including exit code 64 docs) to stdout and exits 0', async () => {
    const { code, stdout, stderr } = await cli(['report', '--help']);
    expect(code).toBe(0);
    expect(stdout).toBe(REPORT_HELP);
    expect(stderr).toBe('');
    expect(stdout).toContain('64  usage error');
    expect(stdout).toContain('never serialized');
  });

  it('-h behaves identically', async () => {
    const { code, stdout } = await cli(['report', '-h']);
    expect(code).toBe(0);
    expect(stdout).toBe(REPORT_HELP);
  });
});

describe('runCli report (real runReport, stdout pure)', () => {
  it('emits exactly one JSON document on stdout for an empty project', async () => {
    const dir = makeTempDir();
    const { code, stdout } = await cli(['report', dir]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { root: string; scope: string };
    expect(parsed.root).toBe(fs.realpathSync(dir));
    expect(parsed.scope).toBe('project');
  });

  it('--pretty pretty-prints', async () => {
    const dir = makeTempDir();
    const { code, stdout } = await cli(['report', '--pretty', dir]);
    expect(code).toBe(0);
    expect(stdout).toContain('\n  "version"');
  });
});

describe('runCli launch dispatch', () => {
  it('no arguments runs launch with open=true, detach=false', async () => {
    const calls: LaunchOptions[] = [];
    const launch = async (opts: LaunchOptions) => {
      calls.push(opts);
      return 0;
    };
    const { code } = await cli([], { launch });
    expect(code).toBe(0);
    expect(calls).toEqual([{ open: true, detach: false }]);
  });

  it('--no-open and --detach are honored on the default command', async () => {
    const calls: LaunchOptions[] = [];
    const launch = async (opts: LaunchOptions) => {
      calls.push(opts);
      return 0;
    };
    await cli(['--no-open', '--detach'], { launch });
    expect(calls).toEqual([{ open: false, detach: true }]);
  });

  it('explicit `launch` subcommand accepts the same flags', async () => {
    const calls: LaunchOptions[] = [];
    const launch = async (opts: LaunchOptions) => {
      calls.push(opts);
      return 0;
    };
    const { code } = await cli(['launch', '--no-open'], { launch });
    expect(code).toBe(0);
    expect(calls).toEqual([{ open: false, detach: false }]);
  });

  it('propagates the launch exit code', async () => {
    const { code } = await cli([], { launch: async () => 1 });
    expect(code).toBe(1);
  });
});

describe('runCli daemon dispatch', () => {
  it('dispatches to the daemon flow with once=false by default', async () => {
    const daemon = vi.fn(async () => 0);
    const { code } = await cli(['daemon'], { daemon });
    expect(code).toBe(0);
    expect(daemon).toHaveBeenCalledWith({ once: false }, expect.anything());
  });

  it('--once sets once=true', async () => {
    const daemon = vi.fn(async () => 0);
    await cli(['daemon', '--once'], { daemon });
    expect(daemon).toHaveBeenCalledWith({ once: true }, expect.anything());
  });

  it('propagates the daemon exit code', async () => {
    const { code } = await cli(['daemon', '--once'], { daemon: async () => 3 });
    expect(code).toBe(3);
  });
});
