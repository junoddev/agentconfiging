/**
 * pipeline-routes — the PIPELINE persistence + run surface (SPEC §5 row 12, E9
 * Pipelines, bead agentconfig-ira.2). Registered under `/api`, so every route
 * INHERITS the hardened app's gates (Host allowlist, bearer token, same-origin/
 * CSRF): the state-changing POSTs/DELETE (save, run, delete) are thus CSRF-gated
 * by the app. RUNNING a pipeline executes bash = the highest privilege on this
 * surface, so the run route is a same-origin POST like every other write.
 *
 * PERSISTENCE: pipelines are user-authored config JSON stored one-file-per-id
 * under the XDG state dir (`~/.local/state/agentconfiging/pipelines/<id>.json`).
 * A pipeline id is the FILENAME stem, so it is validated to a strict, traversal-
 * safe charset ({@link isValidPipelineId}) before it ever touches a path — an id
 * is never interpolated raw into the filesystem.
 *
 * UNTRUSTED FILE DISCIPLINE: a pipeline file is no more trusted than a user
 * write. Every read parses DEFENSIVELY ({@link parsePipeline}: shape-checked,
 * node types allowlisted) and the run path additionally runs {@link safeValidate}
 * (validatePipeline, wrapped so a tampered graph can never throw) BEFORE handing
 * the graph to the executor — an invalid/tampered pipeline is rejected, never
 * run. Save likewise validates and rejects an invalid pipeline.
 *
 * RUN / LIVE STATUS (the model ira.3/ira.4 build on): a run executes the
 * COMMITTED guarded executor (src/server/pipeline — bash/http/file/git bounded +
 * scoped to the instance root; this module never bypasses those guards). The run
 * is fired asynchronously; per-node status events (pending → running → ok|error)
 * from the executor's `emit` seam accumulate into an in-memory RunRecord that the
 * client POLLS via GET /api/pipelines/runs/:runId — the snapshot updates live as
 * nodes transition. (A polled run snapshot was chosen over a WS status stream: it
 * is fully owned by this module, needs no shared WS-hub wiring, and is headless-
 * invokable.) Each finished run is also persisted under the state dir so ira.3's
 * run history has a seam to list/replay.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import { validatePipeline } from '../core/pipeline/index.js';
import type { Pipeline, PipelineEdge, PipelineNode } from '../core/pipeline/index.js';
import { runPipeline } from './pipeline/index.js';
import type { NodeEvent, NodeStatus, RuntimeContext, RuntimeMap } from './pipeline/index.js';
import { defaultStateDir } from './stats-routes.js';
import type { InstanceRegistry } from './registry.js';

/** The 14 node types (SPEC §5 row 12) — the allowlist a defensive parse checks a
 *  tampered node's `type` against before the graph is trusted. */
const NODE_TYPES: ReadonlySet<string> = new Set<PipelineNode['type']>([
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
]);

/** Filename-safe pipeline id: alphanumeric start, then `[A-Za-z0-9_-]`, ≤64.
 *  No `.`, `/`, `\`, or `..` can occur, so the id is traversal-safe as a stem. */
const PIPELINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Max in-memory run records retained (bounds memory; ira.3 owns durable list). */
const MAX_RUNS = 100;

/** True for a strict, traversal-safe pipeline id (see {@link PIPELINE_ID_PATTERN}). */
export function isValidPipelineId(id: unknown): id is string {
  return typeof id === 'string' && PIPELINE_ID_PATTERN.test(id);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Defensive node shape check: object with string id/name and an ALLOWLISTED
 *  type. Deeper config validity is left to validatePipeline/the runtimes; this
 *  only guarantees the graph is well-enough-formed to hand onward without a throw. */
function parseNode(v: unknown): PipelineNode | undefined {
  if (!isPlainObject(v)) return undefined;
  if (typeof v['id'] !== 'string' || v['id'] === '') return undefined;
  if (typeof v['name'] !== 'string' || v['name'] === '') return undefined;
  if (typeof v['type'] !== 'string' || !NODE_TYPES.has(v['type'])) return undefined;
  return v as unknown as PipelineNode;
}

/**
 * Defensively parse an UNTRUSTED value into a Pipeline, or `undefined` when the
 * shape is wrong (a tampered / hand-edited file). Guarantees: valid id, string
 * name, node array of allowlisted-type nodes, edge array of {from,to} strings.
 * Never throws.
 */
export function parsePipeline(raw: unknown): Pipeline | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { id, name, nodes, edges } = raw;
  if (!isValidPipelineId(id)) return undefined;
  if (typeof name !== 'string') return undefined;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return undefined;
  const parsedNodes: PipelineNode[] = [];
  for (const n of nodes) {
    const pn = parseNode(n);
    if (!pn) return undefined;
    parsedNodes.push(pn);
  }
  const parsedEdges: PipelineEdge[] = [];
  for (const e of edges) {
    if (!isPlainObject(e) || typeof e['from'] !== 'string' || typeof e['to'] !== 'string') {
      return undefined;
    }
    parsedEdges.push({ from: e['from'], to: e['to'] });
  }
  return { id, name, nodes: parsedNodes, edges: parsedEdges };
}

/** validatePipeline, wrapped so a malformed graph can NEVER throw (a tampered
 *  node missing a required config field is reported invalid, not a 500). */
export function safeValidate(pipeline: Pipeline): { ok: boolean; errors: string[] } {
  try {
    return validatePipeline(pipeline);
  } catch {
    return { ok: false, errors: ['pipeline is malformed'] };
  }
}

// ── Run records (live status) ─────────────────────────────────────────────────

export interface RunNodeState {
  nodeName: string;
  status: NodeStatus;
  output?: unknown;
  error?: string;
}

export interface RunRecord {
  runId: string;
  pipelineId: string;
  status: 'running' | 'ok' | 'error';
  startedAt: number;
  finishedAt?: number;
  /** Whole-run error (e.g. a validation throw); per-node errors live in `nodes`. */
  error?: string;
  /** Per-node live state, keyed by node id — updated as events stream in. */
  nodes: Record<string, RunNodeState>;
}

/** On-disk pipeline + run store, rooted at `<stateDir>/pipelines`. */
class PipelineStore {
  readonly #dir: string;
  constructor(stateDir: string) {
    this.#dir = path.join(stateDir, 'pipelines');
  }

  /** id is caller-validated (isValidPipelineId) — never a raw/attacker path. */
  #fileFor(id: string): string {
    return path.join(this.#dir, `${id}.json`);
  }

  async list(): Promise<Pipeline[]> {
    let names: string[];
    try {
      names = await readdir(this.#dir);
    } catch {
      return [];
    }
    const out: Pipeline[] = [];
    for (const file of names) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -'.json'.length);
      if (!isValidPipelineId(id)) continue;
      const pipeline = await this.read(id);
      if (pipeline) out.push(pipeline);
    }
    return out;
  }

  async read(id: string): Promise<Pipeline | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.#fileFor(id), 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const pipeline = parsePipeline(parsed);
    // The file's own id MUST match the filename stem, else the file is treated
    // as absent (a mismatched/renamed file cannot masquerade under another id).
    if (pipeline && pipeline.id !== id) return undefined;
    return pipeline;
  }

  async save(pipeline: Pipeline): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    await writeFile(this.#fileFor(pipeline.id), JSON.stringify(pipeline, null, 2), 'utf8');
  }

  async delete(id: string): Promise<boolean> {
    try {
      await rm(this.#fileFor(id));
      return true;
    } catch {
      return false;
    }
  }

  /** Persist a finished run for ira.3's history (best-effort; never throws up). */
  async saveRun(run: RunRecord): Promise<void> {
    const dir = path.join(this.#dir, 'runs');
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${run.runId}.json`), JSON.stringify(run), 'utf8');
    } catch {
      // A state-dir write failure must not crash the run — the live record still
      // reflects the outcome in memory; durable history is ira.3's concern.
    }
  }
}

export interface PipelineRoutesConfig {
  /** Resolves `?instance=` to the run's instance root (bash/git cwd + file scope). */
  registry: InstanceRegistry;
  /** State dir for pipeline/run JSON; defaults to the shared XDG state dir. */
  stateDir?: string;
  /** Injectable runtime table (tests); defaults to the real committed runtimes. */
  runtimes?: RuntimeMap;
  /** Clock for run timestamps; defaults to Date.now. */
  now?: () => number;
}

function jsonError(status: 400 | 404, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A 400 that also carries the structured validation `errors` (the pipeline is
 *  the user's own content, so surfacing why it is invalid is the point). */
function invalidPipeline(errors: string[]): Response {
  return new Response(JSON.stringify({ error: errors.join('; ') || 'invalid pipeline', errors }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

export function registerPipelineRoutes(app: Hono, config: PipelineRoutesConfig): void {
  const registry = config.registry;
  const store = new PipelineStore(config.stateDir ?? defaultStateDir());
  const runtimes = config.runtimes;
  const now = config.now ?? (() => Date.now());

  // In-memory live-run registry, insertion-order bounded to MAX_RUNS.
  const runs = new Map<string, RunRecord>();
  const addRun = (record: RunRecord): void => {
    runs.set(record.runId, record);
    while (runs.size > MAX_RUNS) {
      const oldest = runs.keys().next().value;
      if (oldest === undefined) break;
      runs.delete(oldest);
    }
  };

  // GET /api/pipelines — the saved-pipeline list (each defensively parsed).
  app.get('/api/pipelines', async (c) => {
    const pipelines = await store.list();
    return c.json({
      pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, nodeCount: p.nodes.length })),
    });
  });

  // GET /api/pipelines/runs/:runId — MUST precede /api/pipelines/:id so the
  // static `runs` segment is not captured as an id. The live run snapshot.
  app.get('/api/pipelines/runs/:runId', (c) => {
    const record = runs.get(c.req.param('runId'));
    if (!record) return jsonError(404, 'unknown run');
    return c.json(record);
  });

  // GET /api/pipelines/:id — one pipeline (defensively parsed; unknown → 404).
  app.get('/api/pipelines/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const pipeline = await store.read(id);
    if (!pipeline) return jsonError(404, 'unknown pipeline');
    return c.json({ pipeline });
  });

  // POST /api/pipelines — save/create. The body IS the pipeline; it is parsed
  // defensively then validated (validatePipeline). An invalid pipeline is
  // rejected with its errors — never persisted.
  app.post('/api/pipelines', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(400, 'invalid pipeline');
    }
    const pipeline = parsePipeline(body);
    if (!pipeline) return invalidPipeline(['pipeline shape is invalid']);
    const validation = safeValidate(pipeline);
    if (!validation.ok) return invalidPipeline(validation.errors);
    await store.save(pipeline);
    return c.json({ id: pipeline.id, saved: true });
  });

  // DELETE /api/pipelines/:id — remove a saved pipeline (unknown → 404).
  app.delete('/api/pipelines/:id', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const removed = await store.delete(id);
    if (!removed) return jsonError(404, 'unknown pipeline');
    return c.json({ id, removed: true });
  });

  // POST /api/pipelines/:id/run { input } — run the pipeline through the
  // COMMITTED guarded executor and stream per-node status into a live RunRecord.
  // CSRF-gated by the app (executes bash). Validates BEFORE running — a tampered
  // pipeline is a 400, never executed.
  app.post('/api/pipelines/:id/run', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const pipeline = await store.read(id);
    if (!pipeline) return jsonError(404, 'unknown pipeline');
    const validation = safeValidate(pipeline);
    if (!validation.ok) return invalidPipeline(validation.errors);

    // Pin bash/git cwd + the file-node scope to a REGISTERED instance's root.
    const instance = registry.resolve(new URL(c.req.url).searchParams.get('instance') ?? undefined);
    if (!instance) return jsonError(404, 'unknown instance');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = undefined;
    }
    const input = isPlainObject(body) ? body['input'] : undefined;

    const runId = randomUUID();
    const record: RunRecord = {
      runId,
      pipelineId: id,
      status: 'running',
      startedAt: now(),
      nodes: {},
    };
    addRun(record);

    const emit = (event: NodeEvent): void => {
      const state: RunNodeState = { nodeName: event.nodeName, status: event.status };
      if (event.output !== undefined) state.output = event.output;
      if (event.error !== undefined) state.error = event.error;
      record.nodes[event.nodeId] = state;
    };

    const ctx: RuntimeContext = {
      // File nodes default to a single project scope at this root (see the
      // executor's runtimes) — they cannot escape the instance root.
      instanceRoot: instance.root,
      now,
      emit,
    };

    // Fire-and-forget: the executor updates `record` live via `emit`; the client
    // polls GET /runs/:runId. The committed executor's guards are NOT bypassed.
    void runPipeline(pipeline, input, ctx, runtimes ? { runtimes } : {}).then(
      (result) => {
        record.status = result.status;
        record.finishedAt = now();
        void store.saveRun(record);
      },
      (err: unknown) => {
        record.status = 'error';
        record.finishedAt = now();
        record.error = err instanceof Error ? err.message : String(err);
        void store.saveRun(record);
      },
    );

    return c.json({ runId });
  });
}
