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
 *
 * RUN HISTORY / REPLAY (bead ira.3): finished runs are durable one-file-per-run
 * under `<stateDir>/pipelines/runs/<runId>.json`. GET /api/pipelines/:id/runs
 * lists the most-recent runs for a pipeline (METADATA ONLY — per-node status
 * counts + timing, never output). GET /api/pipelines/runs/:runId is the replay
 * detail: the recorded per-node status + output, served from memory (live) or
 * disk (finished + evicted). Durable runs are BOUNDED per pipeline
 * ({@link MAX_RUNS_PER_PIPELINE}) — a save prunes the oldest beyond the cap. A
 * run id is a server-generated UUID, validated ({@link isValidRunId}) before it
 * touches a path.
 *
 * REDACTION (secret-never-on-wire, SPEC §3): a persisted RunRecord holds RAW
 * per-node output (bash stdout etc.) which can contain a secret the author's
 * script printed. The on-disk record is author-owned; but the run-detail RESPONSE
 * REDACTS every per-node output + error through the shared {@link redact} pass
 * BEFORE it is serialized (the same discipline as session replay), so a replayed
 * run never puts a raw secret on the wire. Output is serialized to text +
 * `[REDACTED:*]` mark spans; the client renders it as text nodes.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import { validatePipeline } from '../core/pipeline/index.js';
import type { Pipeline, PipelineEdge, PipelineNode } from '../core/pipeline/index.js';
import { redact } from '../core/redact/index.js';
import type { RedactionSpan } from '../core/redact/index.js';
import { runPipeline } from './pipeline/index.js';
import type { NodeEvent, NodeStatus, RuntimeContext, RuntimeMap } from './pipeline/index.js';
import { defaultStateDir } from './stats-routes.js';
import { ScheduleStore, computeNextRun, parseCron } from './schedule/index.js';
import type { Schedule } from './schedule/index.js';
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

/** Max in-memory run records retained (bounds memory; the durable list below is
 *  the source of truth for run HISTORY). */
const MAX_RUNS = 100;

/** Durable runs retained PER PIPELINE (ira.3). A save prunes older ones — run
 *  history never grows without bound on disk. */
const MAX_RUNS_PER_PIPELINE = 50;

/** Server-generated run id: a v4-shaped UUID (randomUUID). No `.`, `/`, `\`, or
 *  `..` can occur, so a validated run id is traversal-safe as a filename stem. */
const RUN_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True for a strict, traversal-safe pipeline id (see {@link PIPELINE_ID_PATTERN}). */
export function isValidPipelineId(id: unknown): id is string {
  return typeof id === 'string' && PIPELINE_ID_PATTERN.test(id);
}

/** True for a server-generated, traversal-safe run id (see {@link RUN_ID_PATTERN}). */
export function isValidRunId(id: unknown): id is string {
  return typeof id === 'string' && RUN_ID_PATTERN.test(id);
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

const RUN_STATUSES: ReadonlySet<string> = new Set<RunRecord['status']>(['running', 'ok', 'error']);
const NODE_STATUSES: ReadonlySet<string> = new Set<NodeStatus>([
  'pending',
  'running',
  'ok',
  'error',
]);

/**
 * Defensively parse a persisted run file into a RunRecord, or `undefined` for a
 * tampered/hand-edited file. The runs dir is state a user could hand-edit, so a
 * run file is no more trusted than a pipeline file: ids are re-validated, the
 * status enums allowlisted, and the shape checked before it is served. Raw
 * per-node `output` is carried through unparsed (redacted at serve time, never
 * here). Never throws.
 */
export function parseRunRecord(raw: unknown): RunRecord | undefined {
  if (!isPlainObject(raw)) return undefined;
  const { runId, pipelineId, status, startedAt, finishedAt, error, nodes } = raw;
  if (!isValidRunId(runId)) return undefined;
  if (!isValidPipelineId(pipelineId)) return undefined;
  if (typeof status !== 'string' || !RUN_STATUSES.has(status)) return undefined;
  if (typeof startedAt !== 'number') return undefined;
  if (!isPlainObject(nodes)) return undefined;
  const parsedNodes: Record<string, RunNodeState> = {};
  for (const [key, value] of Object.entries(nodes)) {
    if (!isPlainObject(value)) return undefined;
    const nodeName = value['nodeName'];
    const nodeStatus = value['status'];
    if (typeof nodeName !== 'string') return undefined;
    if (typeof nodeStatus !== 'string' || !NODE_STATUSES.has(nodeStatus)) return undefined;
    const state: RunNodeState = { nodeName, status: nodeStatus as NodeStatus };
    if ('output' in value) state.output = value['output'];
    if (typeof value['error'] === 'string') state.error = value['error'];
    parsedNodes[key] = state;
  }
  const record: RunRecord = {
    runId,
    pipelineId,
    status: status as RunRecord['status'],
    startedAt,
    nodes: parsedNodes,
  };
  if (typeof finishedAt === 'number') record.finishedAt = finishedAt;
  if (typeof error === 'string') record.error = error;
  return record;
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

  #runsDir(): string {
    return path.join(this.#dir, 'runs');
  }

  /** Persist a finished run for run history, then prune the pipeline's oldest
   *  runs beyond the cap (best-effort; a state-dir failure never throws up). */
  async saveRun(run: RunRecord): Promise<void> {
    const dir = this.#runsDir();
    try {
      await mkdir(dir, { recursive: true });
      // runId is a server-generated UUID (validated) — never a raw/attacker path.
      await writeFile(path.join(dir, `${run.runId}.json`), JSON.stringify(run), 'utf8');
      await this.#pruneRuns(run.pipelineId);
    } catch {
      // A state-dir write failure must not crash the run — the live record still
      // reflects the outcome in memory.
    }
  }

  /** Read one persisted run defensively (unknown/tampered → undefined). The
   *  file's own runId MUST match the requested id, else it is treated as absent. */
  async readRun(runId: string): Promise<RunRecord | undefined> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.#runsDir(), `${runId}.json`), 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const record = parseRunRecord(parsed);
    if (record && record.runId !== runId) return undefined;
    return record;
  }

  /** Every persisted run (each defensively parsed; unparseable files skipped). */
  async listRuns(): Promise<RunRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.#runsDir());
    } catch {
      return [];
    }
    const out: RunRecord[] = [];
    for (const file of names) {
      if (!file.endsWith('.json')) continue;
      const runId = file.slice(0, -'.json'.length);
      if (!isValidRunId(runId)) continue;
      const record = await this.readRun(runId);
      if (record) out.push(record);
    }
    return out;
  }

  /** Drop the pipeline's oldest persisted runs beyond {@link MAX_RUNS_PER_PIPELINE}. */
  async #pruneRuns(pipelineId: string): Promise<void> {
    const forPipeline = (await this.listRuns())
      .filter((r) => r.pipelineId === pipelineId)
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const stale of forPipeline.slice(MAX_RUNS_PER_PIPELINE)) {
      try {
        await rm(path.join(this.#runsDir(), `${stale.runId}.json`));
      } catch {
        // A prune failure is harmless — the cap is best-effort.
      }
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

/** A redacted text field: the text with secrets replaced by visible marks, plus
 *  the mark spans over that text (the shape the client renders as text nodes). */
interface RedactedText {
  text: string;
  spans: RedactionSpan[];
}

/** One node's state as SERVED (output/error redacted; never raw). */
interface ServedRunNode {
  nodeName: string;
  status: NodeStatus;
  output?: RedactedText;
  error?: string;
}

/** A run's replay detail as SERVED — redacted, secret-never-on-wire. */
interface ServedRun {
  runId: string;
  pipelineId: string;
  status: RunRecord['status'];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  nodes: Record<string, ServedRunNode>;
}

/** Metadata-only run history row (NO output; the list is content-free). */
interface RunHistoryEntry {
  runId: string;
  pipelineId: string;
  status: RunRecord['status'];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  counts: { ok: number; error: number; pending: number; running: number; total: number };
}

/** Serialize an arbitrary node output to display text (JSON for structured
 *  values). Deterministic + never throws — the input for the redact pass. */
function outputToText(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2) ?? String(output);
  } catch {
    return String(output);
  }
}

/** Redact one node's raw output into the served text+spans shape. */
function redactOutput(output: unknown): RedactedText {
  const { text, spans } = redact(outputToText(output));
  return { text, spans };
}

/** RunRecord → the REDACTED replay detail. Every per-node output + error and the
 *  whole-run error passes through {@link redact} BEFORE serialization, so a raw
 *  secret an author's script printed never crosses the wire (SPEC §3). */
function serveRun(record: RunRecord): ServedRun {
  const nodes: Record<string, ServedRunNode> = {};
  for (const [id, state] of Object.entries(record.nodes)) {
    const node: ServedRunNode = { nodeName: state.nodeName, status: state.status };
    if (state.output !== undefined) node.output = redactOutput(state.output);
    if (state.error !== undefined) node.error = redact(state.error).text;
    nodes[id] = node;
  }
  const served: ServedRun = {
    runId: record.runId,
    pipelineId: record.pipelineId,
    status: record.status,
    startedAt: record.startedAt,
    nodes,
  };
  if (record.finishedAt !== undefined) served.finishedAt = record.finishedAt;
  if (record.error !== undefined) served.error = redact(record.error).text;
  return served;
}

/** RunRecord → a metadata-only history row (per-node status counts + timing). */
function historyEntry(record: RunRecord): RunHistoryEntry {
  const counts = { ok: 0, error: 0, pending: 0, running: 0, total: 0 };
  for (const state of Object.values(record.nodes)) {
    counts[state.status] += 1;
    counts.total += 1;
  }
  const entry: RunHistoryEntry = {
    runId: record.runId,
    pipelineId: record.pipelineId,
    status: record.status,
    startedAt: record.startedAt,
    counts,
  };
  if (record.finishedAt !== undefined) {
    entry.finishedAt = record.finishedAt;
    entry.durationMs = Math.max(0, record.finishedAt - record.startedAt);
  }
  return entry;
}

export function registerPipelineRoutes(app: Hono, config: PipelineRoutesConfig): void {
  const registry = config.registry;
  const stateDir = config.stateDir ?? defaultStateDir();
  const store = new PipelineStore(stateDir);
  const scheduleStore = new ScheduleStore(stateDir);
  const runtimes = config.runtimes;
  const now = config.now ?? (() => Date.now());

  /** Compute the next fire time (epoch ms) for a schedule, or null when disabled/invalid. */
  const nextRunOf = (schedule: Schedule): number | null => {
    if (!schedule.enabled) return null;
    const parsed = parseCron(schedule.cron);
    if ('error' in parsed) return null;
    const next = computeNextRun(parsed, new Date(now()));
    return next ? next.getTime() : null;
  };

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
  // static `runs` segment is not captured as an id. The run REPLAY detail: the
  // live snapshot (in memory) OR a finished run read from disk. Output/error are
  // REDACTED before serialization (secret-never-on-wire, like session replay).
  app.get('/api/pipelines/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    if (!isValidRunId(runId)) return jsonError(400, 'invalid run id');
    const record = runs.get(runId) ?? (await store.readRun(runId));
    if (!record) return jsonError(404, 'unknown run');
    return c.json(serveRun(record));
  });

  // GET /api/pipelines/:id/runs — the run HISTORY for a pipeline: the most-recent
  // runs as METADATA ONLY (status, timing, per-node status counts — never
  // output). In-flight in-memory runs are merged in so a fresh run appears at
  // once; the durable set is bounded per pipeline (pruned on save).
  app.get('/api/pipelines/:id/runs', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const byId = new Map<string, RunRecord>();
    for (const record of await store.listRuns()) {
      if (record.pipelineId === id) byId.set(record.runId, record);
    }
    // In-memory (live / just-finished) records win over any disk copy.
    for (const record of runs.values()) {
      if (record.pipelineId === id) byId.set(record.runId, record);
    }
    const history = [...byId.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_RUNS_PER_PIPELINE)
      .map(historyEntry);
    return c.json({ runs: history });
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

  // GET /api/pipelines/:id/schedule — the pipeline's saved schedule (or null) +
  // its next fire time. The daemon (`agentconfiging daemon`) is what actually
  // RUNS due schedules; the interactive server only reads/writes the schedule.
  app.get('/api/pipelines/:id/schedule', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const schedule = await scheduleStore.get(id);
    if (!schedule) return c.json({ schedule: null, nextRun: null });
    return c.json({ schedule, nextRun: nextRunOf(schedule) });
  });

  // POST /api/pipelines/:id/schedule { cron, enabled } — set (or update) the
  // pipeline's schedule. CSRF-gated by the app. The cron/preset is VALIDATED
  // ({@link parseCron}); the pipeline must exist; the run is bound to the resolved
  // instance's root (bash/git cwd + file scope) — the SAME instance binding a
  // manual run uses. Schedules run only when a daemon is up (documented in the UI).
  app.post('/api/pipelines/:id/schedule', async (c) => {
    const id = c.req.param('id');
    if (!isValidPipelineId(id)) return jsonError(400, 'invalid pipeline id');
    const pipeline = await store.read(id);
    if (!pipeline) return jsonError(404, 'unknown pipeline');

    // Bind to a REGISTERED instance root (unknown → 404), like the run route.
    const instance = registry.resolve(new URL(c.req.url).searchParams.get('instance') ?? undefined);
    if (!instance) return jsonError(404, 'unknown instance');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(400, 'invalid schedule');
    }
    if (!isPlainObject(body)) return jsonError(400, 'invalid schedule');
    const cron = body['cron'];
    if (typeof cron !== 'string') return jsonError(400, 'cron is required');
    const parsed = parseCron(cron);
    if ('error' in parsed) return jsonError(400, `invalid cron: ${parsed.error}`);
    const enabled = body['enabled'] !== false; // default enabled

    const existing = await scheduleStore.get(id);
    const schedule: Schedule = {
      pipelineId: id,
      cron,
      enabled,
      instanceRoot: instance.root,
      ...(existing?.lastRunAt !== undefined ? { lastRunAt: existing.lastRunAt } : {}),
    };
    const saved = await scheduleStore.set(schedule);
    return c.json({ schedule: saved, nextRun: nextRunOf(saved) });
  });
}
