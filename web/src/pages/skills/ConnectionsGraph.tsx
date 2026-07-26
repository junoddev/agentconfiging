/**
 * ConnectionsGraph — the relationships view for the Skills & agents editor
 * (bead agentconfig-wmc.4), doubling as the config graph. A SIMPLE, static,
 * deterministic node+edge layout: skills/agents in the left column, the tools /
 * MCP servers / other agents they reference in the right column, joined by 1px
 * right-angled schematic edges (DESIGN §6 PipelineCanvas flavor). No graph
 * library (react-flow is E9); the layout is pure geometry over sorted indices.
 *
 * All labels are report/frontmatter-derived text rendered as text nodes.
 */

import { EmptyState } from '../../components/core/index.js';
import type { Graph, GraphNode } from './logic.js';

const ROW_H = 40;
const COL_W = 220;
const GAP_X = 120;
const PAD_Y = 8;

function NodeBox({ node, side }: { node: GraphNode; side: 'source' | 'target' }) {
  return (
    <div className={`cgraph__node cgraph__node--${node.kind} cgraph__node--${side}`}>
      <span className="micro-label cgraph__kind">{node.kind}</span>
      <span className="mono-data cgraph__label">{node.label}</span>
    </div>
  );
}

export function ConnectionsGraph({ graph }: { graph: Graph }) {
  const { sources, targets, edges } = graph;
  if (sources.length === 0) {
    return <EmptyState instruction="no skills or agents to graph" />;
  }

  const srcIndex = new Map(sources.map((n, i) => [n.id, i]));
  const tgtIndex = new Map(targets.map((n, i) => [n.id, i]));

  const rows = Math.max(sources.length, targets.length, 1);
  const width = COL_W * 2 + GAP_X;
  const height = rows * ROW_H + PAD_Y * 2;

  const rowCenter = (i: number): number => PAD_Y + i * ROW_H + ROW_H / 2;
  const leftX = COL_W;
  const rightX = COL_W + GAP_X;
  const midX = COL_W + GAP_X / 2;

  return (
    <div className="cgraph" role="group" aria-label="connections graph">
      <div className="cgraph__canvas" style={{ width, height }}>
        <svg
          className="cgraph__edges"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const si = srcIndex.get(edge.from);
            const ti = tgtIndex.get(edge.to);
            if (si === undefined || ti === undefined) return null;
            const sy = rowCenter(si);
            const ty = rowCenter(ti);
            const points = `${leftX},${sy} ${midX},${sy} ${midX},${ty} ${rightX},${ty}`;
            return (
              <polyline key={`${edge.from}->${edge.to}`} className="cgraph__edge" points={points} />
            );
          })}
        </svg>

        <div className="cgraph__col cgraph__col--src">
          {sources.map((node, i) => (
            <div key={node.id} className="cgraph__slot" style={{ top: PAD_Y + i * ROW_H }}>
              <NodeBox node={node} side="source" />
            </div>
          ))}
        </div>

        <div className="cgraph__col cgraph__col--tgt" style={{ left: rightX }}>
          {targets.length === 0 ? (
            <div className="cgraph__slot" style={{ top: PAD_Y }}>
              <span className="micro-label cgraph__empty">no references</span>
            </div>
          ) : (
            targets.map((node, i) => (
              <div key={node.id} className="cgraph__slot" style={{ top: PAD_Y + i * ROW_H }}>
                <NodeBox node={node} side="target" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
