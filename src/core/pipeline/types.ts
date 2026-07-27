/**
 * pipeline/types — the PURE pipeline data model (SPEC §5 row 12, E9 Pipelines,
 * bead agentconfig-ira.1). A pipeline is a typed directed graph of nodes and
 * edges. This module is data-only: no I/O, no execution, no side effects. The
 * executor that actually RUNS a pipeline lives in src/server/pipeline; the
 * validation + templating + safe declarative-transform logic is the rest of
 * src/core/pipeline and is likewise pure.
 *
 * SECURITY POSTURE OF THE MODEL: a Pipeline is UNTRUSTED, user/graph-authored
 * data — it is never more trusted than a user write. The three "logic" node
 * types (transform / filter / json-extract) are declarative CONFIG, never code:
 * see transform.ts for the safe subset. Templating ({{input}}/{{NodeName}}) is
 * pure string substitution (template.ts) — never eval/Function.
 */

/** The 14 node types (SPEC §5 row 12). */
export type NodeType =
  | 'prompt'
  | 'bash'
  | 'github-action'
  | 'http'
  | 'transform'
  | 'delay'
  | 'input'
  | 'output'
  | 'git'
  | 'filter'
  | 'read-file'
  | 'write-file'
  | 'notification'
  | 'json-extract';

/** Fields every node carries. `id` is the graph key (edges reference it);
 *  `name` is the human label AND the {{NodeName}} template key (unique). */
export interface NodeBase {
  id: string;
  name: string;
}

// ── The safe declarative operations (NO eval — see transform.ts) ──────────────

/**
 * A single TRANSFORM operation — a safe, declarative reshape of a JSON object.
 * Deliberately NOT a general expression language: there is no code, no eval, no
 * Function. `set.value` is a literal string (templated at run time as DATA).
 */
export type TransformOp =
  | { op: 'pick'; keys: string[] }
  | { op: 'omit'; keys: string[] }
  | { op: 'rename'; from: string; to: string }
  | { op: 'set'; key: string; value: string };

/** Comparison operators for the FILTER predicate (safe, fixed set — no eval). */
export type FilterOp = 'eq' | 'ne' | 'contains' | 'gt' | 'lt' | 'exists';

/** A safe filter predicate: compare one field against a literal by a fixed op. */
export interface FilterPredicate {
  /** Field to read from each element ('' means the element itself). */
  field: string;
  op: FilterOp;
  /** Comparison literal (unused for `exists`). */
  value?: string | number | boolean;
}

// ── The 14 typed node configs ─────────────────────────────────────────────────

/** LLM prompt node. v1 STUB: validated but not executed (needs an LLM CLI +
 *  token). `prompt` supports {{input}}/{{NodeName}} templating. */
export interface PromptNode extends NodeBase {
  type: 'prompt';
  prompt: string;
  model?: string;
}

/** Runs a user-authored bash script via `execFile('bash', ['-c', script])`,
 *  cwd pinned to the instance root. Documented ARBITRARY EXECUTION (the graph
 *  author is trusted to author shell); timeout + bounded output + no server
 *  token in the child env. `script` is templated as text. */
export interface BashNode extends NodeBase {
  type: 'bash';
  script: string;
}

/** Dispatches a GitHub Actions workflow. v1 STUB: validated but not executed
 *  (needs the `gh` CLI + a token). */
export interface GithubActionNode extends NodeBase {
  type: 'github-action';
  workflow: string;
  ref?: string;
}

/** HTTP request. url/body/header-values are templated. SSRF is an ACCEPTED,
 *  DOCUMENTED risk (user-authored URL) — timeout + response size cap apply. */
export interface HttpNode extends NodeBase {
  type: 'http';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Safe declarative object reshape (NO eval — see transform.ts). */
export interface TransformNode extends NodeBase {
  type: 'transform';
  operations: TransformOp[];
}

/** Bounded pause (capped at DELAY_MAX_MS by the runtime). */
export interface DelayNode extends NodeBase {
  type: 'delay';
  ms: number;
}

/** Entry passthrough — emits the pipeline input. */
export interface InputNode extends NodeBase {
  type: 'input';
}

/** Exit passthrough — emits its upstream input as the pipeline result. */
export interface OutputNode extends NodeBase {
  type: 'output';
}

/** Runs a validated, read-oriented `git` subcommand via the git.ts execFile
 *  pattern, cwd pinned to the instance root. */
export interface GitNode extends NodeBase {
  type: 'git';
  subcommand: string;
  args?: string[];
}

/** Safe declarative predicate filter over an array/value (NO eval). */
export interface FilterNode extends NodeBase {
  type: 'filter';
  predicate: FilterPredicate;
}

/** Reads a file THROUGH the guarded write path (scoped to the instance root —
 *  cannot escape scope). `path` is templated. */
export interface ReadFileNode extends NodeBase {
  type: 'read-file';
  path: string;
}

/** Writes a file THROUGH the guarded write path (resolveWriteTarget +
 *  commitResolved — scoped to the instance root, config-allowlisted). `path`
 *  and `content` are templated. */
export interface WriteFileNode extends NodeBase {
  type: 'write-file';
  path: string;
  content: string;
}

/** Local log notification (an external webhook is the `http` node). Templated. */
export interface NotificationNode extends NodeBase {
  type: 'notification';
  message: string;
  level?: 'info' | 'warn' | 'error';
}

/** Safe JSONPath-ish extraction (dot/index traversal — NO eval). `path` is
 *  templated. */
export interface JsonExtractNode extends NodeBase {
  type: 'json-extract';
  path: string;
}

/** The discriminated union of every node config. */
export type PipelineNode =
  | PromptNode
  | BashNode
  | GithubActionNode
  | HttpNode
  | TransformNode
  | DelayNode
  | InputNode
  | OutputNode
  | GitNode
  | FilterNode
  | ReadFileNode
  | WriteFileNode
  | NotificationNode
  | JsonExtractNode;

/** A directed edge: the output of `from` feeds the input of `to` (node ids). */
export interface PipelineEdge {
  from: string;
  to: string;
}

/** A complete pipeline graph. */
export interface Pipeline {
  id: string;
  name: string;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}
