/**
 * server/pipeline/executor — the async DAG executor (SPEC §5 row 12, E9
 * Pipelines, bead agentconfig-ira.1). Topo-orders a validated pipeline, runs
 * each node with its resolved input + templating, and emits per-node status
 * events (pending → running → ok | error). Designed to run HEADLESS (daemon
 * mode, ira.4): it takes an injectable RuntimeContext + RuntimeMap and returns a
 * plain result — no server, no request, no globals.
 *
 * INPUT WIRING: a node's input is the output of its immediate predecessor(s) —
 * one predecessor → that output; several → an array of their outputs (edge
 * order); none → the pipeline run input. {{input}} always resolves to the
 * pipeline run input; {{NodeName}} resolves to that node's output.
 *
 * FAILURE ISOLATION: a node that throws is marked `error` and its DESCENDANTS
 * are not run (they stay `pending`). Independent branches keep running. Each
 * node is additionally wrapped in a blanket per-node TIMEOUT as a safety net
 * over the runtimes' own bounds.
 */

import { topoSort, resolveTemplate, validatePipeline } from '../../core/pipeline/index.js';
import type { Pipeline } from '../../core/pipeline/index.js';
import { defaultRuntimes } from './runtimes.js';
import type {
  NodeEvent,
  NodeResult,
  NodeStatus,
  PipelineResult,
  RuntimeContext,
  RuntimeMap,
} from './types.js';

/** Blanket per-node timeout (safety net over each runtime's own bounds). */
export const NODE_TIMEOUT_MS = 60_000;

export interface RunOptions {
  /** Injectable runtime table; defaults to the real node runtimes. */
  runtimes?: RuntimeMap;
  /** Blanket per-node timeout in ms. */
  nodeTimeoutMs?: number;
}

class PipelineValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`invalid pipeline: ${errors.join('; ')}`);
    this.name = 'PipelineValidationError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Run a pipeline. Validates first (a cycle / bad reference throws
 * PipelineValidationError — the executor never runs an invalid graph). Emits
 * per-node events through `ctx.emit` and returns the per-node outputs + status.
 */
export async function runPipeline(
  pipeline: Pipeline,
  input: unknown,
  ctx: RuntimeContext,
  options: RunOptions = {},
): Promise<PipelineResult> {
  const validation = validatePipeline(pipeline);
  if (!validation.ok) throw new PipelineValidationError(validation.errors);

  const order = topoSort(pipeline);
  if (!order) throw new PipelineValidationError(['pipeline contains a cycle']);

  const runtimes = options.runtimes ?? defaultRuntimes;
  const nodeTimeoutMs = options.nodeTimeoutMs ?? NODE_TIMEOUT_MS;
  const now = ctx.now ?? Date.now;
  const emit = (event: NodeEvent): void => ctx.emit?.(event);

  const byId = new Map(pipeline.nodes.map((n) => [n.id, n]));
  // Predecessors per node, in edge order (drives input wiring).
  const preds = new Map<string, string[]>(pipeline.nodes.map((n) => [n.id, []]));
  for (const edge of pipeline.edges) {
    if (byId.has(edge.from) && byId.has(edge.to) && edge.from !== edge.to) {
      preds.get(edge.to)!.push(edge.from);
    }
  }

  const outputsById: Record<string, unknown> = {};
  const outputsByName: Record<string, unknown> = {};
  const nodes: Record<string, NodeResult> = {};
  const failed = new Set<string>(); // errored OR skipped-because-upstream-failed

  // Initialize every node to pending (and announce it).
  for (const node of pipeline.nodes) {
    nodes[node.id] = { nodeName: node.name, status: 'pending' };
    emit({ nodeId: node.id, nodeName: node.name, status: 'pending', at: now() });
  }

  let anyError = false;

  for (const id of order) {
    const node = byId.get(id)!;

    // Skip if any predecessor failed/was skipped — leave this node `pending`.
    const predIds = preds.get(id) ?? [];
    if (predIds.some((p) => failed.has(p))) {
      failed.add(id);
      continue;
    }

    // Wire input from predecessor outputs (or the pipeline input at a source).
    const input_: unknown =
      predIds.length === 0
        ? input
        : predIds.length === 1
          ? outputsById[predIds[0]!]
          : predIds.map((p) => outputsById[p]);

    const resolve = (template: string): string =>
      resolveTemplate(template, { input, outputs: outputsByName });

    const setStatus = (status: NodeStatus, patch: Partial<NodeResult> = {}): void => {
      nodes[id] = { nodeName: node.name, status, ...patch };
      emit({ nodeId: id, nodeName: node.name, status, at: now(), ...patch });
    };

    setStatus('running');
    try {
      const runtime = runtimes[node.type];
      const output = await withTimeout(
        runtime({ node, input: input_, ctx, resolve }),
        nodeTimeoutMs,
        `node ${node.name}`,
      );
      outputsById[id] = output;
      outputsByName[node.name] = output;
      setStatus('ok', { output });
    } catch (err) {
      anyError = true;
      failed.add(id);
      setStatus('error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    status: anyError ? 'error' : 'ok',
    nodes,
    outputs: outputsById,
  };
}

export { PipelineValidationError };
