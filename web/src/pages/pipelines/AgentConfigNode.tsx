/**
 * The custom React Flow node (bead ira.2) — a HAIRLINE BOX with a micro-label
 * header, themed to the Console tokens (NOT default React Flow chrome), so it
 * is legible in both themes. Live run status colours the box. Every field shown
 * is UNTRUSTED pipeline config (bash/url/path) rendered as a TEXT NODE only.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PipelineNode, RunNodeStatus } from '../../api/types.js';
import { nodeSummary, statusModifier, type FlowNodeData } from './logic.js';

export function AgentConfigNode({ data, selected }: NodeProps) {
  const { config, status } = data as FlowNodeData;
  return (
    <div
      className={`pipeline-node ${statusModifier(status as RunNodeStatus | undefined)} ${
        selected ? 'pipeline-node--selected' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} className="pipeline-node__handle" />
      <div className="pipeline-node__head micro-label">
        <span className="pipeline-node__type">{(config as PipelineNode).type}</span>
        {status !== undefined && <span className="pipeline-node__dot" aria-hidden="true" />}
      </div>
      <div className="pipeline-node__name mono-data">{(config as PipelineNode).name}</div>
      <div className="pipeline-node__summary mono-data">{nodeSummary(config as PipelineNode)}</div>
      <Handle type="source" position={Position.Right} className="pipeline-node__handle" />
    </div>
  );
}
