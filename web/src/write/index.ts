/** Public surface of the reusable write-flow module (bead agentconfig-wmc.1) —
 *  the dry-run-diff → commit foundation the Findings APPLY and every config
 *  editor (wmc.2-10) build their save flow on. */
export { useWriteFlow } from './useWriteFlow.js';
export type {
  WriteFlowController,
  WriteFlowPhase,
  WritePreview,
  WriteRequest,
} from './useWriteFlow.js';
export { WriteFlow, type WriteFlowProps } from './WriteFlow.js';
export { parseDiff } from './parseDiff.js';
