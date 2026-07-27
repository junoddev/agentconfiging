/**
 * server/pipeline/types — the executor's runtime contract (SPEC §5 row 12, E9
 * Pipelines, bead agentconfig-ira.1). Defines the injectable RuntimeContext,
 * the per-node status event model, the node-runtime interface, and the run
 * result. All I/O the executor performs flows through the injectable seams here
 * (bashExec / httpFetch / gitExec / sleep / log / childEnv), so tests drive the
 * real node-runtime logic with ZERO real side effects.
 */

import type { PipelineNode } from '../../core/pipeline/index.js';
import type { WriteScope } from '../pathguard.js';

// ── Injectable I/O seams ──────────────────────────────────────────────────────

/** How the bash node reaches a shell. Default: execFile('bash', ['-c', script])
 *  with cwd/timeout/bounded-output/sanitized-env. Injectable for tests. */
export type BashExec = (
  script: string,
  opts: { cwd: string; timeoutMs: number; maxBytes: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/** Minimal HTTP response the http node consumes — decoupled from the global
 *  fetch Response so the default (real fetch) and a fake are interchangeable. */
export interface HttpResponseLike {
  status: number;
  headers: Record<string, string>;
  /** Body text, already capped to the size limit by the implementation. */
  text(): Promise<string>;
}

/** How the http node performs a request. Default wraps global fetch with an
 *  AbortController timeout + a response size cap. Injectable for tests. */
export type HttpFetch = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  maxBytes: number;
}) => Promise<HttpResponseLike>;

/** How the git node reaches `git` — the git.ts GitExec shape (execFile, no
 *  shell, arg array, cwd pinned, timeout). Injectable for tests. */
export type GitExecFn = (
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * The execution context threaded to every node runtime. Everything that touches
 * the outside world is here and injectable, so a test constructs a context with
 * fakes and NO real bash/http/git/fs/timer fires.
 */
export interface RuntimeContext {
  /** Instance root — the cwd for bash/git and the containment scope for file
   *  nodes. Every subprocess and file op is confined here. */
  instanceRoot: string;
  /** Write scopes for file nodes; defaults to a single project scope at
   *  instanceRoot when omitted. */
  scopes?: WriteScope[];
  /** Environment for the bash child. Defaults to a sanitized copy of
   *  process.env with the server token stripped (see runtimes.buildChildEnv).
   *  The server bearer token is NEVER placed here. */
  childEnv?: NodeJS.ProcessEnv;
  bashExec?: BashExec;
  httpFetch?: HttpFetch;
  gitExec?: GitExecFn;
  /** Bounded pause primitive for the delay node. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Notification sink. Default: console.log. */
  log?: (message: string) => void;
  /** Clock for event timestamps. Default: Date.now. */
  now?: () => number;
  /** Per-node status event sink (headless-invokable; used by ira.2/ira.3). */
  emit?: (event: NodeEvent) => void;
}

// ── Events + results ──────────────────────────────────────────────────────────

/** A node's lifecycle status. pending → running → ok | error. A node left
 *  `pending` at the end was never run (an upstream node failed). */
export type NodeStatus = 'pending' | 'running' | 'ok' | 'error';

/** One per-node status transition, emitted via RuntimeContext.emit. */
export interface NodeEvent {
  nodeId: string;
  nodeName: string;
  status: NodeStatus;
  /** Present on the terminal `ok` event. */
  output?: unknown;
  /** Present on the terminal `error` event. */
  error?: string;
  /** Milliseconds since epoch (from ctx.now). */
  at: number;
}

/** The final state of one node after a run. */
export interface NodeResult {
  nodeName: string;
  status: NodeStatus;
  output?: unknown;
  error?: string;
}

/** The result of running a whole pipeline. */
export interface PipelineResult {
  /** 'ok' iff every executed node ended `ok`; 'error' if any node errored. */
  status: 'ok' | 'error';
  /** Per-node final state, keyed by node id. */
  nodes: Record<string, NodeResult>;
  /** Per-node output, keyed by node id (present only for nodes that ran ok). */
  outputs: Record<string, unknown>;
}

/** Arguments handed to a single node runtime. */
export interface NodeRunArgs {
  node: PipelineNode;
  /** The resolved input to this node (upstream output(s) or the pipeline
   *  input). */
  input: unknown;
  ctx: RuntimeContext;
  /** Templating bound to the current run context — pure string substitution. */
  resolve: (template: string) => string;
}

/** A node runtime: pure-ish async function returning this node's output. It may
 *  throw; the executor captures the throw as the node's error. */
export type NodeRuntime = (args: NodeRunArgs) => Promise<unknown>;

/** The runtime table: one runtime per node type. Injectable wholesale for tests
 *  that exercise topo-ordering/events without any real node logic. */
export type RuntimeMap = Record<PipelineNode['type'], NodeRuntime>;
