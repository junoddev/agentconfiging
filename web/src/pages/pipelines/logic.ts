/**
 * Pure logic for the PIPELINE CANVAS (bead ira.2). DOM-free + React-free so the
 * LOAD-BEARING behaviour — the React-Flow-graph ⇄ Pipeline-model conversion, the
 * node PALETTE + default configs, a deterministic layered layout, and the live
 * run-status → colour mapping — is unit-testable over plain values. Pipelines.tsx
 * is a thin React Flow renderer over these helpers (the canvas render itself is
 * untested — no DOM env; the conversion is the part that must be correct).
 *
 * A pipeline is UNTRUSTED user-authored config (bash scripts, urls, paths). These
 * functions only shuffle/label plain values — nothing produces markup. Callers
 * render every field as a text node; React Flow owns its own canvas DOM.
 */

import type { Node, Edge } from '@xyflow/react';
import type {
  Pipeline,
  PipelineNode,
  PipelineNodeType,
  RunNodeStatus,
  RunSnapshot,
} from '../../api/types.js';

/** The single custom React Flow node type key (all our nodes share one renderer). */
export const AGENTCONFIG_NODE = 'agentconfig';

/** Data carried on each React Flow node: the pipeline config + optional live
 *  run status (stored loosely so React Flow's generic constraint is satisfied). */
export interface FlowNodeData extends Record<string, unknown> {
  config: PipelineNode;
  status?: RunNodeStatus;
}

/** The 14 node types with a human label + palette order (SPEC §5 row 12). */
export const PALETTE: readonly { type: PipelineNodeType; label: string }[] = [
  { type: 'input', label: 'input' },
  { type: 'output', label: 'output' },
  { type: 'prompt', label: 'prompt' },
  { type: 'bash', label: 'bash' },
  { type: 'http', label: 'http' },
  { type: 'git', label: 'git' },
  { type: 'github-action', label: 'github action' },
  { type: 'read-file', label: 'read file' },
  { type: 'write-file', label: 'write file' },
  { type: 'transform', label: 'transform' },
  { type: 'filter', label: 'filter' },
  { type: 'json-extract', label: 'json extract' },
  { type: 'delay', label: 'delay' },
  { type: 'notification', label: 'notification' },
];

/** A default, structurally-valid config for a freshly-dropped node of `type`. */
export function defaultNodeConfig(type: PipelineNodeType, id: string, name: string): PipelineNode {
  const base = { id, name };
  switch (type) {
    case 'prompt':
      return { ...base, type, prompt: '' };
    case 'bash':
      return { ...base, type, script: '' };
    case 'github-action':
      return { ...base, type, workflow: '' };
    case 'http':
      return { ...base, type, url: 'https://', method: 'GET' };
    case 'transform':
      return { ...base, type, operations: [] };
    case 'delay':
      return { ...base, type, ms: 1000 };
    case 'input':
      return { ...base, type };
    case 'output':
      return { ...base, type };
    case 'git':
      return { ...base, type, subcommand: 'status' };
    case 'filter':
      return { ...base, type, predicate: { field: '', op: 'exists' } };
    case 'read-file':
      return { ...base, type, path: '' };
    case 'write-file':
      return { ...base, type, path: '', content: '' };
    case 'notification':
      return { ...base, type, message: '', level: 'info' };
    case 'json-extract':
      return { ...base, type, path: '' };
  }
}

/** A one-line, plain-text summary of a node's key field (rendered as text). */
export function nodeSummary(config: PipelineNode): string {
  switch (config.type) {
    case 'prompt':
      return config.prompt;
    case 'bash':
      return config.script;
    case 'github-action':
      return config.workflow;
    case 'http':
      return `${config.method ?? 'GET'} ${config.url}`;
    case 'transform':
      return `${config.operations.length} op(s)`;
    case 'delay':
      return `${config.ms}ms`;
    case 'git':
      return `git ${config.subcommand}`;
    case 'filter':
      return `${config.predicate.field || '·'} ${config.predicate.op}`;
    case 'read-file':
    case 'json-extract':
      return config.path;
    case 'write-file':
      return config.path;
    case 'notification':
      return config.message;
    case 'input':
      return 'pipeline input';
    case 'output':
      return 'pipeline output';
  }
}

/** A short, unique, filename-safe pipeline id (matches the server's charset). */
export function makePipelineId(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Next free node id `n1, n2, …` given the ids already in use. */
export function nextNodeId(existing: readonly string[]): string {
  const used = new Set(existing);
  for (let i = 1; ; i += 1) {
    const id = `n${i}`;
    if (!used.has(id)) return id;
  }
}

/** A unique node NAME (names are {{NodeName}} keys → must be unique). */
export function uniqueNodeName(base: string, existing: readonly string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const name = `${base}-${i}`;
    if (!used.has(name)) return name;
  }
}

const COL_W = 220;
const ROW_H = 96;

/**
 * A deterministic layered layout: x by longest-path depth from a source, y by
 * order within the layer. The Pipeline model stores no positions, so a loaded
 * graph is auto-arranged; cycles (never persisted — validation rejects them) are
 * tolerated by bounding the relaxation. Pure + testable.
 */
export function layeredPositions(pipeline: Pipeline): Record<string, { x: number; y: number }> {
  const ids = pipeline.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of pipeline.edges) {
    if (idSet.has(edge.from) && idSet.has(edge.to) && edge.from !== edge.to) {
      preds.get(edge.to)!.push(edge.from);
    }
  }
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  // Bounded relaxation: at most N passes settles any DAG; a stray cycle stops here.
  for (let pass = 0; pass < ids.length; pass += 1) {
    let changed = false;
    for (const id of ids) {
      for (const p of preds.get(id) ?? []) {
        const cand = (layer.get(p) ?? 0) + 1;
        if (cand > (layer.get(id) ?? 0)) {
          layer.set(id, cand);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const rowInLayer = new Map<number, number>();
  const out: Record<string, { x: number; y: number }> = {};
  for (const id of ids) {
    const col = layer.get(id) ?? 0;
    const row = rowInLayer.get(col) ?? 0;
    rowInLayer.set(col, row + 1);
    out[id] = { x: col * COL_W, y: row * ROW_H };
  }
  return out;
}

/** Pipeline model → React Flow graph (custom nodes + 1px right-angled `step`
 *  edges). Positions come from {@link layeredPositions}. */
export function pipelineToGraph(pipeline: Pipeline): { nodes: Node[]; edges: Edge[] } {
  const pos = layeredPositions(pipeline);
  const nodes: Node[] = pipeline.nodes.map((config) => ({
    id: config.id,
    type: AGENTCONFIG_NODE,
    position: pos[config.id] ?? { x: 0, y: 0 },
    data: { config } satisfies FlowNodeData,
  }));
  const edges: Edge[] = pipeline.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    type: 'step',
  }));
  return { nodes, edges };
}

/** React Flow graph → Pipeline model. Each node carries its config in `data`;
 *  edges map source/target → from/to. Pure — the load-bearing save conversion. */
export function graphToPipeline(
  id: string,
  name: string,
  nodes: readonly Node[],
  edges: readonly Edge[],
): Pipeline {
  return {
    id,
    name,
    nodes: nodes.map((n) => (n.data as FlowNodeData).config),
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
  };
}

/** Live run-status → a CSS modifier class for node colouring (§5 live status). */
export function statusModifier(status: RunNodeStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'pipeline-node--running';
    case 'ok':
      return 'pipeline-node--ok';
    case 'error':
      return 'pipeline-node--error';
    case 'pending':
      return 'pipeline-node--pending';
    default:
      return '';
  }
}

/** Overlay a run snapshot's per-node status onto the graph nodes (by id). */
export function applyRunStatus(nodes: readonly Node[], run: RunSnapshot | undefined): Node[] {
  return nodes.map((n) => {
    const status = run?.nodes[n.id]?.status;
    const data = n.data as FlowNodeData;
    return { ...n, data: { ...data, status } satisfies FlowNodeData };
  });
}
