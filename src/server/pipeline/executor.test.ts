/**
 * Executor tests (bead ira.1). Drives the async DAG executor with INJECTED
 * runtimes (no real side effects): topo ordering, the per-node event lifecycle
 * (pending→running→ok/error), failure isolation (a failed node's descendants
 * stay pending, independent branches still run), {{NodeName}} data flow, and the
 * blanket per-node timeout. Validation refusal (cycle) is also covered.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Pipeline, PipelineNode } from '../../core/pipeline/index.js';
import { runPipeline } from './executor.js';
import { defaultRuntimes } from './runtimes.js';
import type { NodeEvent, NodeRuntime, RuntimeContext, RuntimeMap } from './types.js';

const NODE_TYPES = [
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

/** A full RuntimeMap where every type uses one runtime. */
function fullMap(runtime: NodeRuntime): RuntimeMap {
  return Object.fromEntries(NODE_TYPES.map((t) => [t, runtime])) as RuntimeMap;
}

function n(id: string, name: string, type: PipelineNode['type'] = 'input'): PipelineNode {
  return { id, name, type } as PipelineNode;
}

const baseCtx = (extra: Partial<RuntimeContext> = {}): RuntimeContext => ({
  instanceRoot: '/tmp/x',
  ...extra,
});

describe('runPipeline ordering + events', () => {
  it('runs nodes in topological order and emits the full lifecycle', async () => {
    const ran: string[] = [];
    const runtimes = fullMap(async ({ node }) => {
      ran.push(node.id);
      return `out:${node.name}`;
    });
    const events: NodeEvent[] = [];
    const pipeline: Pipeline = {
      id: 'p',
      name: 'p',
      nodes: [n('a', 'A'), n('b', 'B'), n('c', 'C')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    };

    const result = await runPipeline(pipeline, 'IN', baseCtx({ emit: (e) => events.push(e) }), {
      runtimes,
    });

    expect(ran).toEqual(['a', 'b', 'c']);
    expect(result.status).toBe('ok');
    expect(result.outputs).toEqual({ a: 'out:A', b: 'out:B', c: 'out:C' });
    // Each node: pending (init) → running → ok.
    const forA = events.filter((e) => e.nodeId === 'a').map((e) => e.status);
    expect(forA).toEqual(['pending', 'running', 'ok']);
  });

  it('wires the pipeline input into a source node and single-pred output downstream', async () => {
    const seen: Record<string, unknown> = {};
    const runtimes = fullMap(async ({ node, input }) => {
      seen[node.id] = input;
      return `${node.name}=${String(input)}`;
    });
    const pipeline: Pipeline = {
      id: 'p',
      name: 'p',
      nodes: [n('a', 'A'), n('b', 'B')],
      edges: [{ from: 'a', to: 'b' }],
    };
    await runPipeline(pipeline, 'SEED', baseCtx(), { runtimes });
    expect(seen['a']).toBe('SEED'); // source gets the pipeline input
    expect(seen['b']).toBe('A=SEED'); // downstream gets predecessor output
  });
});

describe('runPipeline failure isolation', () => {
  it('marks a failed node error, leaves descendants pending, runs other branches', async () => {
    const runtimes = fullMap(async ({ node }) => {
      if (node.id === 'bad') throw new Error('boom');
      return node.id;
    });
    // a -> bad -> c ; a -> ok2 (independent branch)
    const pipeline: Pipeline = {
      id: 'p',
      name: 'p',
      nodes: [n('a', 'A'), n('bad', 'Bad'), n('c', 'C'), n('ok2', 'Ok2')],
      edges: [
        { from: 'a', to: 'bad' },
        { from: 'bad', to: 'c' },
        { from: 'a', to: 'ok2' },
      ],
    };
    const result = await runPipeline(pipeline, null, baseCtx(), { runtimes });

    expect(result.status).toBe('error');
    expect(result.nodes['bad']!.status).toBe('error');
    expect(result.nodes['bad']!.error).toBe('boom');
    expect(result.nodes['c']!.status).toBe('pending'); // descendant never ran
    expect(result.nodes['ok2']!.status).toBe('ok'); // independent branch ran
  });
});

describe('runPipeline data flow via {{NodeName}}', () => {
  it('resolves {{NodeName}} from an upstream output (default runtimes)', async () => {
    const logged: string[] = [];
    // input node A passes the run input through; notification B references {{A}}.
    const pipeline: Pipeline = {
      id: 'p',
      name: 'p',
      nodes: [
        n('a', 'A', 'input'),
        { id: 'b', name: 'B', type: 'notification', message: 'got {{A}}' } as PipelineNode,
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    await runPipeline(pipeline, 'HELLO', baseCtx({ log: (m) => logged.push(m) }), {
      runtimes: defaultRuntimes,
    });
    expect(logged).toContain('[pipeline:info] got HELLO');
  });
});

describe('runPipeline guards', () => {
  it('throws on an invalid (cyclic) pipeline before running anything', async () => {
    const runtimes = fullMap(async () => 'x');
    const pipeline: Pipeline = {
      id: 'p',
      name: 'p',
      nodes: [n('a', 'A'), n('b', 'B')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    await expect(runPipeline(pipeline, null, baseCtx(), { runtimes })).rejects.toThrow(/cycle/);
  });

  it('enforces the blanket per-node timeout', async () => {
    vi.useFakeTimers();
    try {
      const runtimes = fullMap(() => new Promise<never>(() => {})); // never resolves
      const pipeline: Pipeline = { id: 'p', name: 'p', nodes: [n('a', 'A')], edges: [] };
      const promise = runPipeline(pipeline, null, baseCtx(), { runtimes, nodeTimeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1001);
      const result = await promise;
      expect(result.status).toBe('error');
      expect(result.nodes['a']!.error).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });
});
