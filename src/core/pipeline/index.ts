/**
 * pipeline barrel — the pure pipeline model, templating, safe declarative
 * operations, and validation (SPEC §5 row 12, E9 Pipelines, bead
 * agentconfig-ira.1). Everything here is PURE (no I/O, no eval). The async
 * executor + node runtimes live in src/server/pipeline.
 */

export type {
  NodeType,
  NodeBase,
  TransformOp,
  FilterOp,
  FilterPredicate,
  PromptNode,
  BashNode,
  GithubActionNode,
  HttpNode,
  TransformNode,
  DelayNode,
  InputNode,
  OutputNode,
  GitNode,
  FilterNode,
  ReadFileNode,
  WriteFileNode,
  NotificationNode,
  JsonExtractNode,
  PipelineNode,
  PipelineEdge,
  Pipeline,
} from './types.js';

export {
  REF_PATTERN,
  INPUT_REF,
  stringifyValue,
  extractRefs,
  resolveTemplate,
} from './template.js';
export type { TemplateContext } from './template.js';

export { applyTransform, applyFilter, extractJsonPath, coerceJsonInput } from './transform.js';

export { topoSort, validatePipeline, templateStringsOf } from './validate.js';
export type { ValidationResult } from './validate.js';
