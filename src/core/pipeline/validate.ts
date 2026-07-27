/**
 * pipeline/validate — PURE structural validation of a pipeline graph (SPEC §5
 * row 12, bead agentconfig-ira.1). Answers three questions before anything
 * runs:
 *   1. Is the graph WELL-FORMED? unique node ids, unique node names (names are
 *      the {{NodeName}} template keys), edges referencing real nodes, no
 *      self-edges.
 *   2. Is it a DAG? A cycle is DETECTED and REJECTED — the executor topo-orders
 *      the graph, so a cycle would never terminate.
 *   3. Are all nodes REACHABLE, and do all template references RESOLVE? Every
 *      {{input}}/{{NodeName}} reference in a node's config must point at `input`
 *      or an ANCESTOR node (one with a directed path INTO this node) — a
 *      reference to a non-upstream or unknown node is rejected, because at run
 *      time that output would not yet exist.
 *
 * `topoSort` is exported for the executor to reuse (one source of ordering
 * truth). It is deterministic (Kahn's algorithm, stable by node order).
 */

import { extractRefs, INPUT_REF } from './template.js';
import type { Pipeline, PipelineNode } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Topological order (Kahn's algorithm). Returns `undefined` when the graph
 *  contains a cycle. Deterministic: ties broken by original node order. */
export function topoSort(pipeline: Pipeline): string[] | undefined {
  const ids = pipeline.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const edge of pipeline.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to) || edge.from === edge.to) continue;
    adj.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  // Seed queue in original node order for stable output.
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  return order.length === ids.length ? order : undefined;
}

/**
 * For each node id, the set of ancestor ids (nodes with a directed path INTO
 * it). Computed over the acyclic graph in topo order so each node inherits its
 * predecessors' ancestors.
 */
function computeAncestors(pipeline: Pipeline, order: string[]): Map<string, Set<string>> {
  const preds = new Map<string, string[]>(pipeline.nodes.map((n) => [n.id, []]));
  const idSet = new Set(pipeline.nodes.map((n) => n.id));
  for (const edge of pipeline.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to) || edge.from === edge.to) continue;
    preds.get(edge.to)!.push(edge.from);
  }
  const ancestors = new Map<string, Set<string>>();
  for (const id of order) {
    const set = new Set<string>();
    for (const p of preds.get(id) ?? []) {
      set.add(p);
      for (const a of ancestors.get(p) ?? []) set.add(a);
    }
    ancestors.set(id, set);
  }
  return ancestors;
}

/**
 * The templated string fields of a node (the only places {{ref}} may appear).
 * Kept in one place so validation and the runtimes agree on what is templated.
 */
export function templateStringsOf(node: PipelineNode): string[] {
  switch (node.type) {
    case 'prompt':
      return [node.prompt];
    case 'bash':
      return [node.script];
    case 'github-action':
      return [node.workflow, ...(node.ref !== undefined ? [node.ref] : [])];
    case 'http':
      return [
        node.url,
        ...(node.body !== undefined ? [node.body] : []),
        ...Object.values(node.headers ?? {}),
      ];
    case 'transform':
      return node.operations.flatMap((op) => (op.op === 'set' ? [op.value] : []));
    case 'filter':
      return typeof node.predicate.value === 'string' ? [node.predicate.value] : [];
    case 'read-file':
      return [node.path];
    case 'write-file':
      return [node.path, node.content];
    case 'notification':
      return [node.message];
    case 'json-extract':
      return [node.path];
    case 'delay':
    case 'input':
    case 'output':
    case 'git':
      return [];
  }
}

/**
 * Validate a pipeline. Returns `{ ok, errors }` — `ok` is true iff `errors` is
 * empty. Never throws; collects every problem so the UI can show them all.
 */
/** Cap on nodes per pipeline: bounds total run wall-time (each node is already
 *  per-node-timeout-bounded, but a pathological all-delay graph has no ceiling
 *  on the sum without this). Generous for real workflows. */
export const MAX_PIPELINE_NODES = 500;

export function validatePipeline(pipeline: Pipeline): ValidationResult {
  const errors: string[] = [];

  if (pipeline.nodes.length > MAX_PIPELINE_NODES) {
    errors.push(`pipeline exceeds the ${MAX_PIPELINE_NODES}-node limit`);
  }

  // 1. Well-formedness: unique ids and names.
  const seenIds = new Set<string>();
  const nameToId = new Map<string, string>();
  for (const node of pipeline.nodes) {
    if (typeof node.id !== 'string' || node.id === '') {
      errors.push('node has an empty id');
      continue;
    }
    if (seenIds.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    seenIds.add(node.id);
    if (typeof node.name !== 'string' || node.name === '') {
      errors.push(`node ${node.id} has an empty name`);
    } else if (nameToId.has(node.name)) {
      errors.push(`duplicate node name: ${node.name}`);
    } else {
      nameToId.set(node.name, node.id);
    }
  }

  // Edges must reference real nodes and not be self-edges.
  for (const edge of pipeline.edges) {
    if (!seenIds.has(edge.from)) errors.push(`edge references unknown node: ${edge.from}`);
    if (!seenIds.has(edge.to)) errors.push(`edge references unknown node: ${edge.to}`);
    if (edge.from === edge.to) errors.push(`self-edge on node: ${edge.from}`);
  }

  // 2. DAG: reject cycles.
  const order = topoSort(pipeline);
  if (!order) {
    errors.push('pipeline contains a cycle');
    return { ok: false, errors };
  }

  // 3a. Reachability: every node must be reachable from an entry (indegree-0)
  // node — an isolated island can never receive a run input.
  const reachable = computeReachable(pipeline);
  for (const node of pipeline.nodes) {
    if (!reachable.has(node.id)) errors.push(`node is unreachable: ${node.name || node.id}`);
  }

  // 3b. Template references must resolve to `input` or an ANCESTOR node.
  const ancestors = computeAncestors(pipeline, order);
  const idToName = new Map(pipeline.nodes.map((n) => [n.id, n.name]));
  for (const node of pipeline.nodes) {
    const ancestorNames = new Set(
      [...(ancestors.get(node.id) ?? [])].map((id) => idToName.get(id) ?? ''),
    );
    for (const str of templateStringsOf(node)) {
      for (const ref of extractRefs(str)) {
        if (ref === INPUT_REF) continue;
        if (!nameToId.has(ref)) {
          errors.push(`node ${node.name || node.id} references unknown node: {{${ref}}}`);
        } else if (!ancestorNames.has(ref)) {
          errors.push(`node ${node.name || node.id} references non-upstream node: {{${ref}}}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Nodes reachable from any entry (indegree-0) node, following edges forward. */
function computeReachable(pipeline: Pipeline): Set<string> {
  const idSet = new Set(pipeline.nodes.map((n) => n.id));
  const indegree = new Map<string, number>(pipeline.nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(pipeline.nodes.map((n) => [n.id, []]));
  for (const edge of pipeline.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to) || edge.from === edge.to) continue;
    adj.get(edge.from)!.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const reachable = new Set<string>();
  const stack = pipeline.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) ?? []) stack.push(next);
  }
  return reachable;
}
