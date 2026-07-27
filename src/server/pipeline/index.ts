/**
 * server/pipeline barrel — the async pipeline EXECUTOR + node runtimes (SPEC §5
 * row 12, E9 Pipelines, bead agentconfig-ira.1). The pure model/templating/
 * validation lives in src/core/pipeline; this surface is the I/O side that runs
 * a validated pipeline (and is headless-invokable for the scheduler/daemon,
 * ira.4).
 */

export { runPipeline, PipelineValidationError, NODE_TIMEOUT_MS } from './executor.js';
export type { RunOptions } from './executor.js';

export {
  defaultRuntimes,
  buildChildEnv,
  defaultBashExec,
  defaultHttpFetch,
  defaultGitExecFn,
  isValidGitArg,
  GIT_SUBCOMMANDS,
  STRIPPED_ENV_KEYS,
  BASH_TIMEOUT_MS,
  HTTP_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  HTTP_MAX_BYTES,
  MAX_OUTPUT_BYTES,
  DELAY_MAX_MS,
} from './runtimes.js';

export type {
  RuntimeContext,
  RuntimeMap,
  NodeRuntime,
  NodeRunArgs,
  NodeEvent,
  NodeStatus,
  NodeResult,
  PipelineResult,
  BashExec,
  HttpFetch,
  HttpResponseLike,
  GitExecFn,
} from './types.js';
