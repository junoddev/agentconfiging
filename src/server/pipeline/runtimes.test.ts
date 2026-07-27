/**
 * Node-runtime tests (bead ira.1) — the SECURITY surface. KEY security tests:
 *  - NO SERVER TOKEN IN THE CHILD ENV (buildChildEnv + the bash runtime).
 *  - FILE-SCOPE GUARD: a write-file/read-file node CANNOT escape the instance
 *    root (traversal/out-of-scope/non-config refused).
 *  - bash runs via an injected exec with cwd pinned, timeout, sanitized env.
 *  - http runs via an injected fetch with a size cap + an AbortController
 *    timeout.
 *  - git validates the subcommand + args before the injected execFile.
 * Plus the safe transform/filter/json-extract runtimes and the documented v1
 * stubs. No test performs a real subprocess/network/uncontrolled fs write.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTemplate, type PipelineNode } from '../../core/pipeline/index.js';
import {
  BASH_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  HTTP_MAX_BYTES,
  DELAY_MAX_MS,
  STRIPPED_ENV_KEYS,
  buildChildEnv,
  defaultRuntimes,
  isValidGitArg,
} from './runtimes.js';
import type { HttpFetch, NodeRunArgs, RuntimeContext } from './types.js';

function run(node: PipelineNode, input: unknown, ctx: RuntimeContext): Promise<unknown> {
  const resolve = (t: string): string => resolveTemplate(t, { input, outputs: {} });
  const args: NodeRunArgs = { node, input, ctx, resolve };
  return defaultRuntimes[node.type](args);
}

const ctx = (extra: Partial<RuntimeContext> = {}): RuntimeContext => ({
  instanceRoot: '/tmp/root',
  ...extra,
});

// ── SECURITY: no server token in the child env ────────────────────────────────

describe('buildChildEnv', () => {
  it('strips token-shaped keys and keeps the rest', () => {
    const env = buildChildEnv({ AGENTCONFIG_TOKEN: 'secret', PATH: '/bin', HOME: '/h' });
    expect(env.AGENTCONFIG_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/h');
  });
  it('strips every denylisted key', () => {
    const base: NodeJS.ProcessEnv = { KEEP: '1' };
    for (const k of STRIPPED_ENV_KEYS) base[k] = 'x';
    const env = buildChildEnv(base);
    for (const k of STRIPPED_ENV_KEYS) expect(env[k]).toBeUndefined();
    expect(env.KEEP).toBe('1');
  });
});

describe('bash runtime', () => {
  it('execs the templated script with cwd/timeout and a token-free env', async () => {
    let captured: { script: string; opts: Record<string, unknown> } | undefined;
    const bashExec = vi.fn(async (script: string, opts: Record<string, unknown>) => {
      captured = { script, opts };
      return { stdout: 'HI\n', stderr: '', exitCode: 0 };
    });
    const node = { id: 'b', name: 'B', type: 'bash', script: 'echo {{input}}' } as PipelineNode;
    const childEnv = buildChildEnv({ AGENTCONFIG_TOKEN: 'secret', PATH: '/bin' });

    const out = await run(node, 'HI', ctx({ instanceRoot: '/repo', bashExec, childEnv }));

    expect(captured?.script).toBe('echo HI'); // {{input}} substituted as text
    expect(captured?.opts.cwd).toBe('/repo');
    expect(captured?.opts.timeoutMs).toBe(BASH_TIMEOUT_MS);
    // The KEY assertion: the child env carries no server token.
    expect((captured?.opts.env as NodeJS.ProcessEnv).AGENTCONFIG_TOKEN).toBeUndefined();
    expect(out).toEqual({ stdout: 'HI\n', stderr: '', exitCode: 0 });
  });

  it('default env sanitation removes a token present in process.env', async () => {
    const prev = process.env.AGENTCONFIG_TOKEN;
    process.env.AGENTCONFIG_TOKEN = 'live-secret';
    try {
      let env: NodeJS.ProcessEnv | undefined;
      const bashExec = vi.fn(async (_s: string, opts: { env: NodeJS.ProcessEnv }) => {
        env = opts.env;
        return { stdout: '', stderr: '', exitCode: 0 };
      });
      const node = { id: 'b', name: 'B', type: 'bash', script: 'x' } as PipelineNode;
      // No ctx.childEnv → runtime builds a sanitized copy of process.env.
      await run(node, null, ctx({ bashExec }));
      expect(env?.AGENTCONFIG_TOKEN).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.AGENTCONFIG_TOKEN;
      else process.env.AGENTCONFIG_TOKEN = prev;
    }
  });
});

// ── SECURITY: file nodes cannot escape the instance-root scope ────────────────

describe('file nodes (guarded, scoped)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-')));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes an in-scope config file through the guarded path', async () => {
    const node = {
      id: 'w',
      name: 'W',
      type: 'write-file',
      path: 'CLAUDE.md',
      content: 'hello {{input}}',
    } as PipelineNode;
    const out = (await run(node, 'X', ctx({ instanceRoot: root }))) as { path: string };
    expect(out.path).toBe('CLAUDE.md');
    expect(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf-8')).toBe('hello X');
  });

  it('REFUSES a traversal write outside the scope', async () => {
    const node = {
      id: 'w',
      name: 'W',
      type: 'write-file',
      path: '../escape.md',
      content: 'x',
    } as PipelineNode;
    await expect(run(node, null, ctx({ instanceRoot: root }))).rejects.toThrow(/not allowed/);
    expect(fs.existsSync(path.join(path.dirname(root), 'escape.md'))).toBe(false);
  });

  it('REFUSES an absolute out-of-scope write', async () => {
    const node = {
      id: 'w',
      name: 'W',
      type: 'write-file',
      path: '/etc/passwd',
      content: 'x',
    } as PipelineNode;
    await expect(run(node, null, ctx({ instanceRoot: root }))).rejects.toThrow(/not allowed/);
  });

  it('REFUSES a write to an in-scope but non-config path', async () => {
    const node = {
      id: 'w',
      name: 'W',
      type: 'write-file',
      path: 'evil.sh',
      content: 'x',
    } as PipelineNode;
    await expect(run(node, null, ctx({ instanceRoot: root }))).rejects.toThrow(/not allowed/);
  });

  it('reads an in-scope file through the guarded path', async () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'body');
    const node = { id: 'r', name: 'R', type: 'read-file', path: 'AGENTS.md' } as PipelineNode;
    const out = (await run(node, null, ctx({ instanceRoot: root }))) as { content: string };
    expect(out.content).toBe('body');
  });

  it('REFUSES reading a traversal path', async () => {
    const node = { id: 'r', name: 'R', type: 'read-file', path: '../../etc/hosts' } as PipelineNode;
    await expect(run(node, null, ctx({ instanceRoot: root }))).rejects.toThrow(/not allowed/);
  });
});

// ── SECURITY: http timeout + size cap ─────────────────────────────────────────

describe('http runtime', () => {
  it('templates url/method/headers and passes the size cap + abort signal', async () => {
    let req: Record<string, unknown> | undefined;
    const httpFetch = vi.fn(async (r: Record<string, unknown>) => {
      req = r;
      return { status: 200, headers: { 'content-type': 'text/plain' }, text: async () => 'BODY' };
    });
    const node = {
      id: 'h',
      name: 'H',
      type: 'http',
      url: 'https://example.test/{{input}}',
      method: 'post',
      headers: { 'x-in': '{{input}}' },
      body: 'payload {{input}}',
    } as PipelineNode;

    const out = await run(node, 'ID', ctx({ httpFetch }));

    expect(req?.url).toBe('https://example.test/ID');
    expect(req?.method).toBe('POST');
    expect((req?.headers as Record<string, string>)['x-in']).toBe('ID');
    expect(req?.body).toBe('payload ID');
    expect(req?.maxBytes).toBe(HTTP_MAX_BYTES);
    expect((req?.signal as AbortSignal).aborted).toBe(false);
    expect(out).toEqual({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'BODY' });
  });

  it('rejects a non-http(s) url (no file:// SSRF via scheme)', async () => {
    const node = {
      id: 'h',
      name: 'H',
      type: 'http',
      url: 'file:///etc/passwd',
    } as PipelineNode;
    await expect(run(node, null, ctx())).rejects.toThrow(/http\(s\)/);
  });

  it('aborts the request when the timeout fires', async () => {
    vi.useFakeTimers();
    try {
      const httpFetch: HttpFetch = ({ signal }) =>
        new Promise((_res, rej) => {
          signal.addEventListener('abort', () => rej(new Error('aborted')));
        });
      const node = {
        id: 'h',
        name: 'H',
        type: 'http',
        url: 'https://slow.test',
      } as PipelineNode;
      const p = run(node, null, ctx({ httpFetch }));
      const assertion = expect(p).rejects.toThrow(/aborted/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── git validation ────────────────────────────────────────────────────────────

describe('isValidGitArg', () => {
  it('accepts safe args/flags/refs', () => {
    for (const ok of ['HEAD', '--oneline', '-n5', 'main', 'v1.0.0', 'refs/heads/x']) {
      expect(isValidGitArg(ok)).toBe(true);
    }
  });
  it('rejects whitespace, metachars, ranges, and empty', () => {
    for (const bad of ['a b', 'a;b', 'a|b', 'a$(x)', 'a..b', '']) {
      expect(isValidGitArg(bad)).toBe(false);
    }
  });
});

describe('git runtime', () => {
  it('runs a validated read subcommand via the injected exec with pinned cwd', async () => {
    let call: { args: string[]; opts: Record<string, unknown> } | undefined;
    const gitExec = vi.fn(async (args: string[], opts: Record<string, unknown>) => {
      call = { args, opts };
      return { stdout: 'clean', stderr: '' };
    });
    const node = {
      id: 'g',
      name: 'G',
      type: 'git',
      subcommand: 'status',
      args: ['--porcelain'],
    } as PipelineNode;
    const out = await run(node, null, ctx({ instanceRoot: '/repo', gitExec }));
    expect(call?.args).toEqual(['status', '--porcelain']);
    expect(call?.opts.cwd).toBe('/repo');
    expect(call?.opts.timeoutMs).toBe(GIT_TIMEOUT_MS);
    expect(out).toEqual({ stdout: 'clean', stderr: '' });
  });

  it('refuses a non-allowlisted subcommand', async () => {
    const node = { id: 'g', name: 'G', type: 'git', subcommand: 'push' } as PipelineNode;
    await expect(run(node, null, ctx({ gitExec: vi.fn() }))).rejects.toThrow(/not allowed/);
  });

  it('refuses mutating subcommands removed after the security review (config/branch/remote)', async () => {
    // git config can write ~/.gitconfig + set command-valued keys that run on the
    // next git op; branch -D deletes; remote set-url mutates. All out of scope.
    for (const subcommand of ['config', 'branch', 'remote']) {
      const node = { id: 'g', name: 'G', type: 'git', subcommand } as PipelineNode;
      const gitExec = vi.fn();
      await expect(run(node, null, ctx({ gitExec }))).rejects.toThrow(/not allowed/);
      expect(gitExec).not.toHaveBeenCalled();
    }
  });

  it('refuses an invalid arg', async () => {
    const node = {
      id: 'g',
      name: 'G',
      type: 'git',
      subcommand: 'log',
      args: ['a;rm'],
    } as PipelineNode;
    await expect(run(node, null, ctx({ gitExec: vi.fn() }))).rejects.toThrow(/invalid arg/);
  });
});

// ── safe logic runtimes + delay + stubs ───────────────────────────────────────

describe('logic + delay + stub runtimes', () => {
  it('transform applies safe ops with a templated set value', async () => {
    const node = {
      id: 't',
      name: 'T',
      type: 'transform',
      operations: [
        { op: 'pick', keys: ['a'] },
        { op: 'set', key: 'who', value: '{{input}}' },
      ],
    } as PipelineNode;
    const out = await run(node, 'ME', ctx());
    // input to the transform is the run input string → non-object → {} base,
    // pick yields {}, set adds who. (Templated value resolved as DATA.)
    expect(out).toEqual({ who: 'ME' });
  });

  it('filter keeps matching array elements', async () => {
    const node = {
      id: 'f',
      name: 'F',
      type: 'filter',
      predicate: { field: 'n', op: 'gt', value: 1 },
    } as PipelineNode;
    const out = await run(node, [{ n: 0 }, { n: 2 }], ctx());
    expect(out).toEqual([{ n: 2 }]);
  });

  it('json-extract traverses a JSON string input', async () => {
    const node = { id: 'j', name: 'J', type: 'json-extract', path: 'a.b' } as PipelineNode;
    const out = await run(node, '{"a":{"b":7}}', ctx());
    expect(out).toBe(7);
  });

  it('delay clamps ms to the ceiling', async () => {
    const sleep = vi.fn(async () => {});
    const node = { id: 'd', name: 'D', type: 'delay', ms: 10_000_000 } as PipelineNode;
    await run(node, null, ctx({ sleep }));
    expect(sleep).toHaveBeenCalledWith(DELAY_MAX_MS);
  });

  it('prompt + github-action are documented stubs (validated, not executed)', async () => {
    const prompt = { id: 'p', name: 'P', type: 'prompt', prompt: 'hi' } as PipelineNode;
    const gh = { id: 'x', name: 'X', type: 'github-action', workflow: 'ci' } as PipelineNode;
    expect(await run(prompt, null, ctx())).toMatchObject({ stub: true });
    expect(await run(gh, null, ctx())).toMatchObject({ stub: true, workflow: 'ci' });
  });

  it('input and output nodes pass their input through', async () => {
    const inNode = { id: 'i', name: 'I', type: 'input' } as PipelineNode;
    const outNode = { id: 'o', name: 'O', type: 'output' } as PipelineNode;
    expect(await run(inNode, 'V', ctx())).toBe('V');
    expect(await run(outNode, 'V', ctx())).toBe('V');
  });
});
