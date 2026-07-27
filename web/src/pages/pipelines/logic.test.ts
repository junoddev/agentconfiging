import { describe, expect, it } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { Pipeline, RunSnapshot } from '../../api/types.js';
import {
  AGENTCONFIG_NODE,
  PALETTE,
  applyRunStatus,
  defaultNodeConfig,
  graphToPipeline,
  layeredPositions,
  makePipelineId,
  nextNodeId,
  nodeSummary,
  pipelineToGraph,
  statusModifier,
  uniqueNodeName,
  type FlowNodeData,
} from './logic.js';

const PIPE: Pipeline = {
  id: 'demo',
  name: 'Demo',
  nodes: [
    { id: 'a', name: 'in', type: 'input' },
    { id: 'b', name: 'sh', type: 'bash', script: 'echo {{in}}' },
    { id: 'c', name: 'out', type: 'output' },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
};

describe('palette', () => {
  it('offers exactly the 14 node types', () => {
    expect(PALETTE).toHaveLength(14);
    const types = new Set(PALETTE.map((p) => p.type));
    expect(types.size).toBe(14);
  });

  it('builds a structurally-valid default config for every type', () => {
    for (const { type } of PALETTE) {
      const config = defaultNodeConfig(type, 'n1', 'name');
      expect(config.type).toBe(type);
      expect(config.id).toBe('n1');
      expect(config.name).toBe('name');
    }
    expect(defaultNodeConfig('bash', 'x', 'y')).toEqual({
      id: 'x',
      name: 'y',
      type: 'bash',
      script: '',
    });
    expect(defaultNodeConfig('delay', 'x', 'y')).toMatchObject({ type: 'delay', ms: 1000 });
  });
});

describe('model ⇄ graph conversion', () => {
  it('round-trips a pipeline through graph and back (structure preserved)', () => {
    const { nodes, edges } = pipelineToGraph(PIPE);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((n) => n.type === AGENTCONFIG_NODE)).toBe(true);
    // Edges are right-angled schematic `step` edges.
    expect(edges.every((e) => e.type === 'step')).toBe(true);
    const back = graphToPipeline('demo', 'Demo', nodes, edges);
    expect(back).toEqual(PIPE);
  });

  it('maps React Flow source/target back to from/to', () => {
    const nodes: Node[] = [
      {
        id: 'a',
        position: { x: 0, y: 0 },
        data: { config: PIPE.nodes[0]! } satisfies FlowNodeData,
      },
      {
        id: 'b',
        position: { x: 0, y: 0 },
        data: { config: PIPE.nodes[1]! } satisfies FlowNodeData,
      },
    ];
    const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b' }];
    const p = graphToPipeline('x', 'X', nodes, edges);
    expect(p.edges).toEqual([{ from: 'a', to: 'b' }]);
    expect(p.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('lays out nodes left→right by dependency depth', () => {
    const pos = layeredPositions(PIPE);
    expect(pos['a']!.x).toBe(0);
    expect(pos['b']!.x).toBeGreaterThan(pos['a']!.x);
    expect(pos['c']!.x).toBeGreaterThan(pos['b']!.x);
  });

  it('tolerates a cycle without looping forever', () => {
    const cyclic: Pipeline = {
      id: 'c',
      name: 'c',
      nodes: [
        { id: 'a', name: 'a', type: 'input' },
        { id: 'b', name: 'b', type: 'output' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(Object.keys(layeredPositions(cyclic))).toEqual(['a', 'b']);
  });
});

describe('node summary', () => {
  it('summarizes the load-bearing field per type (as text)', () => {
    expect(nodeSummary({ id: 'a', name: 'a', type: 'bash', script: 'ls' })).toBe('ls');
    expect(nodeSummary({ id: 'a', name: 'a', type: 'http', url: 'x', method: 'POST' })).toBe(
      'POST x',
    );
    expect(nodeSummary({ id: 'a', name: 'a', type: 'input' })).toBe('pipeline input');
  });
});

describe('id / name helpers', () => {
  it('generates a filename-safe pipeline id', () => {
    expect(makePipelineId()).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  });
  it('picks the next free node id', () => {
    expect(nextNodeId([])).toBe('n1');
    expect(nextNodeId(['n1', 'n2'])).toBe('n3');
    expect(nextNodeId(['n2'])).toBe('n1');
  });
  it('disambiguates duplicate node names', () => {
    expect(uniqueNodeName('bash', [])).toBe('bash');
    expect(uniqueNodeName('bash', ['bash'])).toBe('bash-2');
    expect(uniqueNodeName('bash', ['bash', 'bash-2'])).toBe('bash-3');
  });
});

describe('live run status', () => {
  it('maps each status to a colour modifier', () => {
    expect(statusModifier('running')).toBe('pipeline-node--running');
    expect(statusModifier('ok')).toBe('pipeline-node--ok');
    expect(statusModifier('error')).toBe('pipeline-node--error');
    expect(statusModifier('pending')).toBe('pipeline-node--pending');
    expect(statusModifier(undefined)).toBe('');
  });

  it('overlays a run snapshot onto graph nodes by id', () => {
    const { nodes } = pipelineToGraph(PIPE);
    const run: RunSnapshot = {
      runId: 'r',
      pipelineId: 'demo',
      status: 'running',
      startedAt: 0,
      nodes: {
        a: { nodeName: 'in', status: 'ok' },
        b: { nodeName: 'sh', status: 'running' },
      },
    };
    const painted = applyRunStatus(nodes, run);
    expect((painted[0]!.data as FlowNodeData).status).toBe('ok');
    expect((painted[1]!.data as FlowNodeData).status).toBe('running');
    expect((painted[2]!.data as FlowNodeData).status).toBeUndefined();
  });
});
