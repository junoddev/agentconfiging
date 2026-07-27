/**
 * server/pipeline/runtimes — the 14 node runtimes (SPEC §5 row 12, E9
 * Pipelines, bead agentconfig-ira.1). This is the security surface: the
 * executor can run HEADLESS (daemon mode, ira.4), so every runtime that touches
 * the outside world obeys the same discipline the rest of the server does.
 *
 * THE PER-RUNTIME SECURITY MODEL (each I/O runtime obeys ALL that apply):
 *  - TIMEOUT: every subprocess/request is bounded; the executor also wraps each
 *    node in a blanket per-node timeout.
 *  - BOUNDED OUTPUT: subprocess/response bytes are capped (maxBuffer / a stream
 *    cap) so a runaway node cannot exhaust memory.
 *  - NO SERVER TOKEN IN THE CHILD ENV: the bash child gets a sanitized env
 *    (buildChildEnv) — the server's bearer token lives only in memory and is
 *    never exported to a child, and a denylist of token-shaped vars is stripped
 *    as belt-and-suspenders. Nothing here ever injects the token.
 *  - execFile, NEVER a shell command string: bash uses execFile('bash',
 *    ['-c', script]) (the script is one argv slot, no outer shell); git uses the
 *    git.ts arg-array pattern with a validated subcommand.
 *  - cwd PINNED to the instance root for bash + git.
 *  - FILE NODES go THROUGH THE GUARDED WRITE PATH (resolveWriteTarget +
 *    commitResolved) scoped to the instance root — a pipeline file node is
 *    UNTRUSTED-authored, no more trusted than a user write, and CANNOT escape
 *    scope.
 *  - transform / filter / json-extract are the SAFE declarative core (NO eval).
 *
 * DOCUMENTED ACCEPTED RISKS (user/graph-authored, by design):
 *  - bash runs arbitrary shell the graph author wrote (cwd-scoped, timed,
 *    token-free env). {{input}} is substituted as TEXT into the script; the
 *    author already has arbitrary execution, so templating grants nothing more.
 *  - http may reach an internal address (SSRF) because the URL is author-chosen.
 *    Bounded by timeout + size cap; not otherwise restricted in v1.
 *
 * v1 DOCUMENTED STUBS (validated, not executed — they need an external CLI +
 * token that is out of scope for this bead): prompt (LLM CLI), github-action
 * (gh CLI).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { defaultGitExec } from '../git.js';
import { resolveWriteTarget, type WriteScope } from '../pathguard.js';
import { commitResolved } from '../write.js';
import {
  applyFilter,
  applyTransform,
  coerceJsonInput,
  extractJsonPath,
  type BashNode,
  type FilterNode,
  type GitNode,
  type HttpNode,
  type JsonExtractNode,
  type NotificationNode,
  type ReadFileNode,
  type TransformNode,
  type WriteFileNode,
} from '../../core/pipeline/index.js';
import type {
  BashExec,
  GitExecFn,
  HttpFetch,
  HttpResponseLike,
  NodeRunArgs,
  NodeRuntime,
  RuntimeMap,
} from './types.js';

// ── Bounds ────────────────────────────────────────────────────────────────────

export const BASH_TIMEOUT_MS = 30_000;
export const HTTP_TIMEOUT_MS = 15_000;
export const GIT_TIMEOUT_MS = 10_000;
/** Max bytes captured from a bash child (stdout+stderr buffer) or a file read. */
export const MAX_OUTPUT_BYTES = 1024 * 1024; // 1 MiB
/** Max bytes read from an http response. */
export const HTTP_MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
/** delay is clamped to this ceiling regardless of the node's `ms`. */
export const DELAY_MAX_MS = 20_000;

// ── Child-env sanitation (NO server token) ────────────────────────────────────

/**
 * Env var names stripped from any child process. The server's bearer token is
 * generated with crypto.randomBytes and kept IN MEMORY (see server/index.ts) —
 * it is never placed in the environment, so there is nothing to leak here by
 * default. This denylist is belt-and-suspenders: should a token ever be exported
 * under one of these names, the bash child still never receives it. The user's
 * OWN environment otherwise passes through (bash is user-authored execution).
 */
export const STRIPPED_ENV_KEYS: readonly string[] = [
  'AGENTCONFIG_TOKEN',
  'AGENTCONFIG_SERVER_TOKEN',
  'AGENTCONFIG_BEARER_TOKEN',
  'AGENTCONFIG_SESSION_TOKEN',
];

/** A child env: a shallow copy of `base` with the token-shaped keys removed. */
export function buildChildEnv(
  base: NodeJS.ProcessEnv = process.env,
  extraStrip: readonly string[] = [],
): NodeJS.ProcessEnv {
  const deny = new Set([...STRIPPED_ENV_KEYS, ...extraStrip]);
  const out: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(base)) {
    if (!deny.has(key)) out[key] = base[key];
  }
  return out;
}

// ── Default I/O implementations ───────────────────────────────────────────────

/** Default bash exec: execFile a shell with the script as a single argv slot —
 *  no outer shell parses metacharacters. Timeout + bounded buffer + the given
 *  (sanitized) env + pinned cwd. A nonzero exit is a RESULT (captured with its
 *  code), not a throw; a spawn failure/timeout throws. */
export const defaultBashExec: BashExec = (script, { cwd, timeoutMs, maxBytes, env }) =>
  new Promise((resolve, reject) => {
    execFile(
      'bash',
      ['-c', script],
      { cwd, timeout: timeoutMs, maxBuffer: maxBytes, env, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (e.killed === true) return reject(new Error('bash timed out'));
          if (e.code === 'ENOENT') return reject(new Error('bash not found'));
          // Nonzero exit: surface as a captured result, not a failure.
          const exitCode = typeof e.code === 'number' ? e.code : 1;
          return resolve({ stdout, stderr, exitCode });
        }
        resolve({ stdout, stderr, exitCode: 0 });
      },
    );
  });

/** Read a web ReadableStream body, capped at `maxBytes` (aborting the rest). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      chunks.push(value);
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks).toString('utf-8').slice(0, maxBytes);
}

/** Default http fetch: global fetch, AbortController timeout (wired by the
 *  runtime), response body streamed + capped. */
export const defaultHttpFetch: HttpFetch = async ({
  url,
  method,
  headers,
  body,
  signal,
  maxBytes,
}) => {
  const res = await fetch(url, { method, headers, body, signal, redirect: 'follow' });
  const headerObj: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headerObj[k] = v;
  });
  const response: HttpResponseLike = {
    status: res.status,
    headers: headerObj,
    text: () => readCapped(res, maxBytes),
  };
  return response;
};

/** Default git exec adapts the git.ts execFile pattern (fixed `git`, arg array,
 *  no shell, pinned cwd, bounded buffer, timeout). */
export const defaultGitExecFn: GitExecFn = (args, { cwd, timeoutMs }) =>
  defaultGitExec(args, { cwd, timeoutMs });

// ── Validation helpers ────────────────────────────────────────────────────────

/** STRICTLY read-only git subcommands the git node may run in v1. Anything with
 *  a mutating form is excluded: `config` (writes ~/.gitconfig, and command-valued
 *  keys like core.hooksPath/sshCommand execute on the next git op),
 *  `branch` (`-D` deletes), and `remote` (`set-url`/`remove` mutate) are OUT —
 *  a git node is a reporting primitive, not a repo-mutation one (use the Git
 *  panel or a bash node for mutations). Tightened per the ira.1 security review. */
export const GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'describe',
  'shortlog',
]);

/** A conservative git-arg charset: alphanumerics + safe ref/flag punctuation.
 *  Excludes whitespace and shell metacharacters (belt to the arg-array exec),
 *  and refuses `..` (range/traversal). Leading `-` is permitted only for the
 *  enumerated read subcommands whose flags are inert. */
const GIT_ARG_CHARSET = /^[A-Za-z0-9._/@~=+-]+$/;
const MAX_GIT_ARGS = 20;

export function isValidGitArg(arg: string): boolean {
  return (
    typeof arg === 'string' &&
    arg.length > 0 &&
    arg.length <= 256 &&
    GIT_ARG_CHARSET.test(arg) &&
    !arg.includes('..')
  );
}

/** The write scopes for a file node: an explicit ctx.scopes, else a single
 *  project scope rooted at the instance root. */
function fileScopes(instanceRoot: string, scopes: WriteScope[] | undefined): WriteScope[] {
  return scopes ?? [{ root: instanceRoot, kind: 'project' }];
}

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

// ── The 14 runtimes ───────────────────────────────────────────────────────────

const runBash: NodeRuntime = async ({ node, ctx, resolve }) => {
  const script = resolve((node as BashNode).script);
  const exec = ctx.bashExec ?? defaultBashExec;
  const env = ctx.childEnv ?? buildChildEnv();
  const r = await exec(script, {
    cwd: ctx.instanceRoot,
    timeoutMs: BASH_TIMEOUT_MS,
    maxBytes: MAX_OUTPUT_BYTES,
    env,
  });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
};

const runHttp: NodeRuntime = async ({ node, ctx, resolve }) => {
  const cfg = node as HttpNode;
  const url = resolve(cfg.url);
  if (!/^https?:\/\//i.test(url)) throw new Error('http node: url must be http(s)');
  const method = (cfg.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = resolve(v);
  const body = cfg.body !== undefined ? resolve(cfg.body) : undefined;

  const fetchImpl = ctx.httpFetch ?? defaultHttpFetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchImpl({
      url,
      method,
      headers,
      body,
      signal: controller.signal,
      maxBytes: HTTP_MAX_BYTES,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text };
  } finally {
    clearTimeout(timer);
  }
};

const runGit: NodeRuntime = async ({ node, ctx }) => {
  const cfg = node as GitNode;
  if (!GIT_SUBCOMMANDS.has(cfg.subcommand)) {
    throw new Error(`git node: subcommand not allowed: ${cfg.subcommand}`);
  }
  const args = cfg.args ?? [];
  if (args.length > MAX_GIT_ARGS) throw new Error('git node: too many args');
  for (const arg of args) {
    if (!isValidGitArg(arg)) throw new Error(`git node: invalid arg: ${arg}`);
  }
  const exec = ctx.gitExec ?? defaultGitExecFn;
  const r = await exec([cfg.subcommand, ...args], {
    cwd: ctx.instanceRoot,
    timeoutMs: GIT_TIMEOUT_MS,
  });
  return { stdout: r.stdout, stderr: r.stderr };
};

const runReadFile: NodeRuntime = async ({ node, ctx, resolve }) => {
  const rel = resolve((node as ReadFileNode).path);
  const resolved = resolveWriteTarget(rel, fileScopes(ctx.instanceRoot, ctx.scopes));
  if (!resolved.ok) throw new Error('read-file node: path not allowed');
  // Guarded read: O_NOFOLLOW refuses a symlinked leaf (TOCTOU) rather than
  // reading out of scope; content is capped.
  let fd: number;
  try {
    fd = fs.openSync(resolved.absPath, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') throw new Error('read-file node: path not allowed', { cause: err });
    if (code === 'ENOENT') throw new Error('read-file node: file not found', { cause: err });
    throw err;
  }
  try {
    const buf = fs.readFileSync(fd);
    const content = buf.subarray(0, MAX_OUTPUT_BYTES).toString('utf-8');
    return { path: resolved.relPath, content };
  } finally {
    fs.closeSync(fd);
  }
};

const runWriteFile: NodeRuntime = async ({ node, ctx, resolve }) => {
  const cfg = node as WriteFileNode;
  const rel = resolve(cfg.path);
  const content = resolve(cfg.content);
  const resolved = resolveWriteTarget(rel, fileScopes(ctx.instanceRoot, ctx.scopes));
  // An out-of-scope / traversal / non-config target is REFUSED here — the file
  // node cannot escape the instance-root scope.
  if (!resolved.ok) throw new Error('write-file node: path not allowed');
  try {
    commitResolved(resolved, content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('write-file node: path not allowed', { cause: err });
    }
    throw err;
  }
  return { path: resolved.relPath, bytes: Buffer.byteLength(content, 'utf-8') };
};

const runDelay: NodeRuntime = async ({ node, ctx }) => {
  const raw = (node as { ms?: unknown }).ms;
  const ms = Math.min(
    Math.max(0, Number.isFinite(raw) ? Math.floor(raw as number) : 0),
    DELAY_MAX_MS,
  );
  const sleep = ctx.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m)));
  await sleep(ms);
  return { delayedMs: ms };
};

const runNotification: NodeRuntime = async ({ node, ctx, resolve }) => {
  const cfg = node as NotificationNode;
  const message = resolve(cfg.message);
  const level = cfg.level ?? 'info';
  const log = ctx.log ?? ((m: string) => console.log(m));
  log(`[pipeline:${level}] ${message}`);
  return { message, level };
};

const runInput: NodeRuntime = async ({ input }) => input;
const runOutput: NodeRuntime = async ({ input }) => input;

const runTransform: NodeRuntime = async ({ node, input, resolve }) => {
  const cfg = node as TransformNode;
  // Resolve {{...}} in `set` values as DATA before the pure transform runs —
  // the transform itself never evaluates a string as code.
  const ops = cfg.operations.map((op) =>
    op.op === 'set' ? { ...op, value: resolve(op.value) } : op,
  );
  return applyTransform(input, ops);
};

const runFilter: NodeRuntime = async ({ node, input, resolve }) => {
  const cfg = node as FilterNode;
  const predicate =
    typeof cfg.predicate.value === 'string'
      ? { ...cfg.predicate, value: resolve(cfg.predicate.value) }
      : cfg.predicate;
  return applyFilter(input, predicate);
};

const runJsonExtract: NodeRuntime = async ({ node, input, resolve }) => {
  const path = resolve((node as JsonExtractNode).path);
  return extractJsonPath(coerceJsonInput(input), path);
};

/** v1 STUB: validated, not executed (needs an LLM runtime CLI + token). */
const runPrompt: NodeRuntime = async ({ node, resolve }) => {
  const prompt = resolve((node as { prompt: string }).prompt);
  return {
    stub: true,
    note: 'prompt node requires an LLM runtime CLI + token; not executed in v1',
    prompt,
  };
};

/** v1 STUB: validated, not executed (needs the `gh` CLI + a token). */
const runGithubAction: NodeRuntime = async ({ node }) => {
  const cfg = node as { workflow: string; ref?: string };
  return {
    stub: true,
    note: 'github-action node requires the gh CLI + a token; not executed in v1',
    workflow: cfg.workflow,
    ref: cfg.ref,
  };
};

/** The default runtime table — one runtime per node type. */
export const defaultRuntimes: RuntimeMap = {
  prompt: runPrompt,
  bash: runBash,
  'github-action': runGithubAction,
  http: runHttp,
  transform: runTransform,
  delay: runDelay,
  input: runInput,
  output: runOutput,
  git: runGit,
  filter: runFilter,
  'read-file': runReadFile,
  'write-file': runWriteFile,
  notification: runNotification,
  'json-extract': runJsonExtract,
};

export type { NodeRunArgs };
