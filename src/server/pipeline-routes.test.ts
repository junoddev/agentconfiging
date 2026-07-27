/**
 * Adversarial in-process tests for the PIPELINE routes (bead ira.2). Requests go
 * straight into `app.fetch` (no socket). The executor is exercised through
 * INJECTED runtimes (never a real bash/http/git/fs side effect), so the run route
 * is proven to go through the COMMITTED executor (runPipeline) — topo order,
 * per-node status events, failure isolation — with zero real execution, alongside
 * the INHERITED token + Origin/CSRF gates. Also pinned here: filename-safe id
 * validation (traversal-safe), the untrusted-file defensive parse, validate-
 * before-save AND validate-before-run, and the CSRF/token gate on the RUN route.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import {
  isValidPipelineId,
  isValidRunId,
  parsePipeline,
  parseRunRecord,
} from './pipeline-routes.js';
import type { NodeRuntime, RuntimeMap } from './pipeline/index.js';
import type { Pipeline } from '../core/pipeline/index.js';

const PORT = 8841;
const HOST = `127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'pipe-session-token-pipe-session-token-01';
const tokenHash = createHash('sha256').update(TOKEN).digest();
const AUTH = { authorization: `Bearer ${TOKEN}` };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-pipe-'));
fs.mkdirSync(path.join(base, 'project'), { recursive: true });
const projectRoot = fs.realpathSync(path.join(base, 'project'));

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** A fresh state dir per app so tests do not cross-contaminate saved files. */
function freshStateDir(): string {
  return fs.mkdtempSync(path.join(base, 'state-'));
}

const PASSTHROUGH: NodeRuntime = async ({ input }) => input;
const NODE_TYPE_KEYS = [
  'prompt',
  'bash',
  'github-action',
  'http',
  'transform',
  'delay',
  'input',
  'output',
  'git',
  'filter',
  'read-file',
  'write-file',
  'notification',
  'json-extract',
] as const;

/** Build a full RuntimeMap of passthroughs, with per-type overrides. */
function buildRuntimes(overrides: Partial<RuntimeMap> = {}): RuntimeMap {
  const map = {} as RuntimeMap;
  for (const key of NODE_TYPE_KEYS) map[key] = PASSTHROUGH;
  return { ...map, ...overrides };
}

function appWith(opts: { stateDir?: string; runtimes?: RuntimeMap } = {}): Hono {
  const registry = new InstanceRegistry('1.0.0');
  registry.seed(projectRoot, { makeDefault: true });
  return createApp({
    tokenHash,
    port: () => PORT,
    distDir: path.join(base, 'nodist'),
    registry,
    version: '1.0.0',
    pipelineStateDir: opts.stateDir ?? freshStateDir(),
    ...(opts.runtimes ? { pipelineRuntimes: opts.runtimes } : {}),
  });
}

function get(app: Hono, pathname: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, { headers: { host: HOST, ...AUTH, ...headers } }),
    ),
  );
}

function post(
  app: Hono,
  pathname: string,
  body: unknown,
  headers: Record<string, string> = { origin: ORIGIN },
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...AUTH, ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function del(app: Hono, pathname: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`http://${HOST}${pathname}`, {
        method: 'DELETE',
        headers: { host: HOST, origin: ORIGIN, ...AUTH },
      }),
    ),
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Poll a run snapshot until it finishes (or a bounded number of ticks). */
async function pollRun(app: Hono, runId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i += 1) {
    const res = await get(app, `/api/pipelines/runs/${runId}`);
    const json = (await res.json()) as Record<string, unknown>;
    if (json['finishedAt'] !== undefined) return json;
    await tick();
  }
  throw new Error('run did not finish');
}

/** A minimal valid two-node pipeline: input → bash. */
function validPipeline(id = 'demo'): Pipeline {
  return {
    id,
    name: 'Demo',
    nodes: [
      { id: 'a', name: 'in', type: 'input' },
      { id: 'b', name: 'sh', type: 'bash', script: 'echo hi' },
    ],
    edges: [{ from: 'a', to: 'b' }],
  };
}

describe('pipeline id validation', () => {
  it('accepts filename-safe ids and rejects traversal / unsafe ones', () => {
    expect(isValidPipelineId('demo')).toBe(true);
    expect(isValidPipelineId('a1_B-2')).toBe(true);
    expect(isValidPipelineId('..')).toBe(false);
    expect(isValidPipelineId('a/b')).toBe(false);
    expect(isValidPipelineId('a.b')).toBe(false);
    expect(isValidPipelineId('../etc/passwd')).toBe(false);
    expect(isValidPipelineId('')).toBe(false);
    expect(isValidPipelineId('-lead')).toBe(false);
    expect(isValidPipelineId(42)).toBe(false);
  });
});

describe('parsePipeline (defensive)', () => {
  it('parses a well-formed pipeline', () => {
    expect(parsePipeline(validPipeline())).toEqual(validPipeline());
  });
  it('rejects tampered shapes', () => {
    expect(parsePipeline(null)).toBeUndefined();
    expect(parsePipeline({ id: 'x', name: 'n', nodes: 'nope', edges: [] })).toBeUndefined();
    expect(parsePipeline({ id: '../x', name: 'n', nodes: [], edges: [] })).toBeUndefined();
    // Unknown node type is rejected by the allowlist.
    expect(
      parsePipeline({
        id: 'x',
        name: 'n',
        nodes: [{ id: 'a', name: 'a', type: 'evil' }],
        edges: [],
      }),
    ).toBeUndefined();
    // Edge that is not {from,to} strings.
    expect(
      parsePipeline({ id: 'x', name: 'n', nodes: [], edges: [{ from: 'a', to: 5 }] }),
    ).toBeUndefined();
  });
});

describe('save / load / list / delete', () => {
  it('saves, lists, loads, and deletes a pipeline', async () => {
    const app = appWith();
    const saveRes = await post(app, '/api/pipelines', validPipeline());
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toEqual({ id: 'demo', saved: true });

    const listRes = await get(app, '/api/pipelines');
    expect(await listRes.json()).toEqual({
      pipelines: [{ id: 'demo', name: 'Demo', nodeCount: 2 }],
    });

    const loadRes = await get(app, '/api/pipelines/demo');
    expect(await loadRes.json()).toEqual({ pipeline: validPipeline() });

    const delRes = await del(app, '/api/pipelines/demo');
    expect(delRes.status).toBe(200);
    expect(await del(app, '/api/pipelines/demo')).toMatchObject({ status: 404 });
    expect((await get(app, '/api/pipelines/demo')).status).toBe(404);
  });

  it('rejects a bad id on load/delete with 400', async () => {
    const app = appWith();
    expect((await get(app, '/api/pipelines/a.b')).status).toBe(400);
    expect((await del(app, '/api/pipelines/a.b')).status).toBe(400);
  });

  it('rejects an invalid pipeline on save (surfacing errors) and never persists it', async () => {
    const app = appWith();
    const cyclic: Pipeline = {
      id: 'bad',
      name: 'Bad',
      nodes: [
        { id: 'a', name: 'a', type: 'input' },
        { id: 'b', name: 'b', type: 'output' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    const res = await post(app, '/api/pipelines', cyclic);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: string[] };
    expect(body.errors.some((e) => e.includes('cycle'))).toBe(true);
    // Not persisted.
    expect((await get(app, '/api/pipelines/bad')).status).toBe(404);
  });

  it('rejects a shape-invalid body on save', async () => {
    const app = appWith();
    const res = await post(app, '/api/pipelines', { id: 'x', name: 'n', nodes: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('untrusted-file discipline', () => {
  it('treats a malformed/tampered file as absent (404) on load', async () => {
    const stateDir = freshStateDir();
    const dir = path.join(stateDir, 'pipelines');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'junk.json'), '{ not valid json');
    fs.writeFileSync(
      path.join(dir, 'weird.json'),
      JSON.stringify({
        id: 'weird',
        name: 'w',
        nodes: [{ id: 'a', name: 'a', type: 'evil' }],
        edges: [],
      }),
    );
    const app = appWith({ stateDir });
    expect((await get(app, '/api/pipelines/junk')).status).toBe(404);
    expect((await get(app, '/api/pipelines/weird')).status).toBe(404);
    // The list skips both unparseable files.
    const list = (await (await get(app, '/api/pipelines')).json()) as { pipelines: unknown[] };
    expect(list.pipelines).toEqual([]);
  });

  it('validates before running a tampered-but-parseable pipeline (cycle → 400)', async () => {
    const stateDir = freshStateDir();
    const dir = path.join(stateDir, 'pipelines');
    fs.mkdirSync(dir, { recursive: true });
    // A cycle is shape-valid but structurally invalid: it must never run.
    fs.writeFileSync(
      path.join(dir, 'cyc.json'),
      JSON.stringify({
        id: 'cyc',
        name: 'c',
        nodes: [
          { id: 'a', name: 'a', type: 'input' },
          { id: 'b', name: 'b', type: 'output' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' },
        ],
      }),
    );
    const app = appWith({ stateDir, runtimes: buildRuntimes() });
    const res = await post(app, '/api/pipelines/cyc/run', { input: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('run (through the committed executor)', () => {
  it('runs a pipeline through runPipeline, streaming per-node status', async () => {
    const calls: string[] = [];
    const bash: NodeRuntime = async ({ node }) => {
      calls.push(node.name);
      return { stdout: 'hi', exitCode: 0 };
    };
    const app = appWith({ runtimes: buildRuntimes({ bash }) });
    await post(app, '/api/pipelines', validPipeline());

    const runRes = await post(app, '/api/pipelines/demo/run', { input: 'seed' });
    expect(runRes.status).toBe(200);
    const { runId } = (await runRes.json()) as { runId: string };
    expect(typeof runId).toBe('string');

    const final = await pollRun(app, runId);
    expect(final['status']).toBe('ok');
    expect(final['pipelineId']).toBe('demo');
    const nodes = final['nodes'] as Record<
      string,
      { status: string; output?: { text: string; spans: unknown[] } }
    >;
    expect(nodes['a']?.status).toBe('ok');
    expect(nodes['b']?.status).toBe('ok');
    // Output is REDACTED + serialized to text server-side (no secret here → the
    // raw JSON text is preserved verbatim, with no marks).
    expect(nodes['b']?.output?.text).toContain('hi');
    expect(nodes['b']?.output?.spans).toEqual([]);
    // It genuinely went through the executor's per-node dispatch.
    expect(calls).toEqual(['sh']);
  });

  it('exposes live intermediate status while a node is still running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const bash: NodeRuntime = async () => {
      await gate;
      return { stdout: 'done' };
    };
    const app = appWith({ runtimes: buildRuntimes({ bash }) });
    await post(app, '/api/pipelines', validPipeline());
    const { runId } = (await (await post(app, '/api/pipelines/demo/run', {})).json()) as {
      runId: string;
    };

    // Let the input node settle; the bash node is blocked on the gate.
    for (let i = 0; i < 5; i += 1) await tick();
    const mid = (await (await get(app, `/api/pipelines/runs/${runId}`)).json()) as {
      status: string;
      finishedAt?: number;
      nodes: Record<string, { status: string }>;
    };
    expect(mid.status).toBe('running');
    expect(mid.finishedAt).toBeUndefined();
    expect(mid.nodes['b']?.status).toBe('running');

    release();
    const final = await pollRun(app, runId);
    expect(final['status']).toBe('ok');
  });

  it('404s an unknown pipeline run and a valid-but-unknown run snapshot', async () => {
    const app = appWith({ runtimes: buildRuntimes() });
    expect((await post(app, '/api/pipelines/missing/run', {})).status).toBe(404);
    // A malformed (non-UUID) run id is rejected BEFORE any lookup (400).
    expect((await get(app, '/api/pipelines/runs/nope')).status).toBe(400);
    expect((await get(app, '/api/pipelines/runs/..%2f..%2fetc')).status).toBe(400);
    // A well-formed but unknown run id is a 404.
    expect((await get(app, `/api/pipelines/runs/${randomUUID()}`)).status).toBe(404);
  });
});

describe('run is token + CSRF gated', () => {
  it('rejects a run with no token (401)', async () => {
    const app = appWith({ runtimes: buildRuntimes() });
    await post(app, '/api/pipelines', validPipeline());
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/pipelines/demo/run`, {
          method: 'POST',
          headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a run with neither Origin nor Sec-Fetch-Site same-origin (403)', async () => {
    const app = appWith({ runtimes: buildRuntimes() });
    await post(app, '/api/pipelines', validPipeline());
    const res = await Promise.resolve(
      app.fetch(
        new Request(`http://${HOST}/api/pipelines/demo/run`, {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json', ...AUTH },
          body: '{}',
        }),
      ),
    );
    expect(res.status).toBe(403);
  });
});

// ── Run history + replay (bead ira.3) ────────────────────────────────────────

/** A real AWS-style access key; it MUST be redacted before it reaches the wire. */
const SECRET = 'AKIAIOSFODNN7EXAMPLE';

function runsDirOf(stateDir: string): string {
  return path.join(stateDir, 'pipelines', 'runs');
}

/** Plant a persisted run file (simulating a finished, on-disk run). */
function writeRunFile(stateDir: string, run: Record<string, unknown>): string {
  const dir = runsDirOf(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const runId = run['runId'] as string;
  fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify(run));
  return runId;
}

function makeRun(
  pipelineId: string,
  startedAt: number,
  nodes: Record<string, unknown> = { a: { nodeName: 'in', status: 'ok' } },
): Record<string, unknown> {
  return {
    runId: randomUUID(),
    pipelineId,
    status: 'ok',
    startedAt,
    finishedAt: startedAt + 5,
    nodes,
  };
}

async function waitFor(fn: () => boolean | Promise<boolean>, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    if (await fn()) return;
    await tick();
  }
  throw new Error('condition not met');
}

describe('run id validation', () => {
  it('accepts server UUIDs and rejects unsafe / non-UUID ids', () => {
    expect(isValidRunId(randomUUID())).toBe(true);
    expect(isValidRunId('nope')).toBe(false);
    expect(isValidRunId('../../etc/passwd')).toBe(false);
    expect(isValidRunId('')).toBe(false);
    expect(isValidRunId(42)).toBe(false);
  });
});

describe('parseRunRecord (defensive)', () => {
  it('parses a well-formed run and rejects tampered shapes', () => {
    const good = makeRun('demo', 10);
    expect(parseRunRecord(good)?.runId).toBe(good['runId']);
    expect(parseRunRecord(null)).toBeUndefined();
    expect(parseRunRecord({ ...makeRun('demo', 1), runId: 'not-a-uuid' })).toBeUndefined();
    // Traversal-unsafe pipelineId is rejected.
    expect(parseRunRecord(makeRun('../x', 1))).toBeUndefined();
    expect(parseRunRecord({ ...makeRun('demo', 1), status: 'weird' })).toBeUndefined();
    expect(
      parseRunRecord({ ...makeRun('demo', 1), nodes: { a: { nodeName: 'x', status: 'nope' } } }),
    ).toBeUndefined();
  });
});

describe('run history list', () => {
  it('lists a pipeline runs newest-first as metadata only (never output)', async () => {
    const stateDir = freshStateDir();
    const r1 = writeRunFile(
      stateDir,
      makeRun('demo', 100, {
        a: { nodeName: 'in', status: 'ok' },
        b: { nodeName: 'sh', status: 'error', output: { stdout: 'x' }, error: 'boom' },
      }),
    );
    const r2 = writeRunFile(stateDir, makeRun('demo', 300));
    writeRunFile(stateDir, makeRun('other', 200)); // a different pipeline — excluded
    const app = appWith({ stateDir });

    const res = await get(app, '/api/pipelines/demo/runs');
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The list is content-free: no per-node output crosses in the history view.
    expect(raw).not.toContain('output');
    const body = JSON.parse(raw) as {
      runs: { runId: string; startedAt: number; durationMs?: number; counts: { total: number } }[];
    };
    expect(body.runs.map((r) => r.runId)).toEqual([r2, r1]); // newest first
    const first = body.runs.find((r) => r.runId === r1)!;
    expect(first.counts.total).toBe(2);
    expect(first.durationMs).toBe(5);
  });

  it('400s a bad pipeline id and returns an empty list for an unknown pipeline', async () => {
    const app = appWith();
    expect((await get(app, '/api/pipelines/a.b/runs')).status).toBe(400);
    expect(await (await get(app, '/api/pipelines/ghost/runs')).json()).toEqual({ runs: [] });
  });

  it('merges an in-flight in-memory run into the history immediately', async () => {
    const app = appWith({ runtimes: buildRuntimes() });
    await post(app, '/api/pipelines', validPipeline());
    const { runId } = (await (await post(app, '/api/pipelines/demo/run', {})).json()) as {
      runId: string;
    };
    const body = (await (await get(app, '/api/pipelines/demo/runs')).json()) as {
      runs: { runId: string }[];
    };
    expect(body.runs.some((r) => r.runId === runId)).toBe(true);
  });
});

describe('run detail redaction (secret-never-on-wire)', () => {
  it('redacts a secret in a persisted run output; the raw secret is absent from the response', async () => {
    const stateDir = freshStateDir();
    const runId = writeRunFile(
      stateDir,
      makeRun('demo', 42, {
        a: { nodeName: 'in', status: 'ok' },
        b: { nodeName: 'sh', status: 'ok', output: { stdout: `token=${SECRET} done` } },
      }),
    );
    const app = appWith({ stateDir });

    const res = await get(app, `/api/pipelines/runs/${runId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // THE security assertion: raw secret gone, visible mark present.
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('[REDACTED:aws_access_key]');
    const body = JSON.parse(raw) as {
      nodes: Record<string, { output?: { text: string; spans: unknown[] } }>;
    };
    expect(body.nodes['b']?.output?.text).toContain('[REDACTED:aws_access_key]');
    expect((body.nodes['b']?.output?.spans.length ?? 0) > 0).toBe(true);

    // Author-owned AT REST: the persisted file still holds the raw secret — we
    // redact on the wire, not on disk (the same discipline as session replay).
    const onDisk = fs.readFileSync(path.join(runsDirOf(stateDir), `${runId}.json`), 'utf8');
    expect(onDisk).toContain(SECRET);
  });

  it('redacts a secret in a node error string too', async () => {
    const stateDir = freshStateDir();
    const runId = writeRunFile(
      stateDir,
      makeRun('demo', 42, { a: { nodeName: 'sh', status: 'error', error: `died: ${SECRET}` } }),
    );
    const app = appWith({ stateDir });
    const raw = await (await get(app, `/api/pipelines/runs/${runId}`)).text();
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('[REDACTED:aws_access_key]');
  });
});

describe('run history is bounded (prune)', () => {
  it('prunes the oldest runs beyond the per-pipeline cap when a new run is saved', async () => {
    const stateDir = freshStateDir();
    // Plant 51 demo runs with ascending startedAt (1..51) — one over the cap.
    const planted: string[] = [];
    for (let i = 1; i <= 51; i += 1) {
      const run = makeRun('demo', i);
      writeRunFile(stateDir, run);
      planted.push(run['runId'] as string);
    }
    const oldest = planted[0]!;
    const app = appWith({ stateDir, runtimes: buildRuntimes() });
    await post(app, '/api/pipelines', validPipeline()); // id 'demo'
    const { runId } = (await (await post(app, '/api/pipelines/demo/run', {})).json()) as {
      runId: string;
    };
    await pollRun(app, runId);

    // Saving this 52nd run prunes down to the cap (50). saveRun is fire-and-
    // forget, so wait for the async write + prune to settle.
    const dir = runsDirOf(stateDir);
    const jsonCount = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    await waitFor(() => jsonCount() === 50);
    // The oldest planted run was dropped; this newest run was kept.
    expect(fs.existsSync(path.join(dir, `${oldest}.json`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${runId}.json`))).toBe(true);
  });
});
