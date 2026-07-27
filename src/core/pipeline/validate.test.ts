/**
 * Pipeline validation tests (bead ira.1): DAG/cycle detection, reachability,
 * template-reference resolution (must point at `input` or an upstream node),
 * and well-formedness (unique ids/names, real edges). Plus topoSort ordering.
 */

import { describe, expect, it } from 'vitest';
import { topoSort, validatePipeline } from './validate.js';
import type { Pipeline, PipelineNode } from './types.js';

function node(id: string, name: string, extra: Partial<PipelineNode> = {}): PipelineNode {
  return { id, name, type: 'input', ...extra } as PipelineNode;
}

function pipe(nodes: PipelineNode[], edges: { from: string; to: string }[]): Pipeline {
  return { id: 'p', name: 'p', nodes, edges };
}

describe('topoSort', () => {
  it('orders a linear DAG', () => {
    const p = pipe(
      [node('a', 'A'), node('b', 'B'), node('c', 'C')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    expect(topoSort(p)).toEqual(['a', 'b', 'c']);
  });
  it('returns undefined on a cycle', () => {
    const p = pipe(
      [node('a', 'A'), node('b', 'B')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    expect(topoSort(p)).toBeUndefined();
  });
});

describe('validatePipeline', () => {
  it('accepts a valid linear pipeline', () => {
    const p = pipe(
      [
        node('a', 'A'),
        node('b', 'B', { type: 'notification', message: 'hi {{A}} {{input}}' } as never),
      ],
      [{ from: 'a', to: 'b' }],
    );
    expect(validatePipeline(p)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a cycle', () => {
    const p = pipe(
      [node('a', 'A'), node('b', 'B')],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    );
    const r = validatePipeline(p);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('pipeline contains a cycle');
  });

  it('rejects duplicate ids and names', () => {
    const p = pipe([node('a', 'A'), node('a', 'A')], []);
    const r = validatePipeline(p);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('duplicate node id: a');
    expect(r.errors).toContain('duplicate node name: A');
  });

  it('rejects an edge to an unknown node', () => {
    const p = pipe([node('a', 'A')], [{ from: 'a', to: 'ghost' }]);
    const r = validatePipeline(p);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('edge references unknown node: ghost');
  });

  it('rejects a reference to an unknown node', () => {
    const p = pipe([node('a', 'A', { type: 'notification', message: '{{Nope}}' } as never)], []);
    const r = validatePipeline(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('unknown node: {{Nope}}'))).toBe(true);
  });

  it('rejects a reference to a NON-upstream node', () => {
    // B references A, but there is no edge A->B, so A is not upstream of B.
    const p = pipe(
      [node('a', 'A'), node('b', 'B', { type: 'notification', message: '{{A}}' } as never)],
      [],
    );
    const r = validatePipeline(p);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('non-upstream node: {{A}}'))).toBe(true);
  });

  it('{{input}} is always a valid reference', () => {
    const p = pipe([node('a', 'A', { type: 'bash', script: 'echo {{input}}' } as never)], []);
    expect(validatePipeline(p).ok).toBe(true);
  });
});
