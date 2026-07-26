import { describe, expect, it } from 'vitest';
import { EX_USAGE, runCli } from './main.js';
import { REPORT_HELP } from './report.js';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(argv: string[]): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    stdout: (chunk) => void out.push(chunk),
    stderr: (chunk) => void err.push(chunk),
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

describe('runCli usage errors (EX_USAGE = 64, stderr only)', () => {
  it('unknown command exits 64 with message + usage on stderr, empty stdout', () => {
    const { code, stdout, stderr } = cli(['frobnicate']);
    expect(code).toBe(EX_USAGE);
    expect(stdout).toBe('');
    expect(stderr).toContain('unknown command: frobnicate');
    expect(stderr).toContain('Usage: agentconfiging report');
  });

  it('unknown report flag exits 64, distinct from the warnings-found exit 1', () => {
    const { code, stdout, stderr } = cli(['report', '--nope']);
    expect(code).toBe(EX_USAGE);
    expect(code).not.toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('unknown flag for report: --nope');
    expect(stderr).toContain('Usage: agentconfiging report');
  });

  it('extra positional exits 64', () => {
    expect(cli(['report', 'a', 'b']).code).toBe(EX_USAGE);
  });
});

describe('runCli report --help', () => {
  it('prints the help (including exit code 64 docs) to stdout and exits 0', () => {
    const { code, stdout, stderr } = cli(['report', '--help']);
    expect(code).toBe(0);
    expect(stdout).toBe(REPORT_HELP);
    expect(stderr).toBe('');
    expect(stdout).toContain('64  usage error');
    expect(stdout).toContain('never serialized');
  });
});
