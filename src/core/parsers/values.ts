/**
 * Safe value helpers shared by all parsers.
 *
 * Parsed YAML/JSON/TOML keys are user-controlled (adversarial), so every
 * record that survives into a model is rebuilt with a null prototype —
 * `__proto__` / `constructor` keys become inert own data properties and can
 * never reach `Object.prototype`. Structure walks are bounded three ways:
 * nesting depth cap, total node budget, and on-path cycle detection (YAML
 * anchors can legally produce cyclic or exponentially-shared object graphs).
 */

import { problem, type ParseProblem } from './result.js';

/** Maximum nesting depth kept when sanitizing parsed structures. */
export const MAX_DEPTH = 64;

/** Maximum container nodes kept when sanitizing parsed structures. */
export const MAX_NODES = 100_000;

/**
 * Input-size cap applied at every public parser entry. The scanner inlines
 * at most 64 KiB of content per file (CAPS.maxFileBytes in scanner.ts), so
 * real manifest content is always under a quarter of this; anything larger
 * is adversarial or a mistake and is rejected unparsed.
 */
export const MAX_INPUT_LENGTH = 256 * 1024;

/**
 * Maximum bracket-nesting depth tolerated in YAML input (pre-scan). The
 * yaml library's error recovery on deeply nested flow collections is
 * super-linear (64 KiB of '{' costs ~18s CPU), so pathological nesting is
 * rejected before parsing. Legitimate config never comes close: anything
 * deeper than MAX_DEPTH gets truncated by sanitize() anyway.
 */
export const MAX_FLOW_DEPTH = 4096;

/** A record safe to index with user-controlled keys (null prototype). */
export type SafeRecord = Record<string, unknown>;

export interface EnvEntry {
  key: string;
  value: string;
}

/** Returns a problem when content exceeds MAX_INPUT_LENGTH, else undefined. */
export function inputSizeProblem(content: string): ParseProblem | undefined {
  if (content.length <= MAX_INPUT_LENGTH) return undefined;
  return problem(
    '$',
    `input of ${content.length} characters exceeds the ${MAX_INPUT_LENGTH}-character cap; not parsed`,
  );
}

/**
 * Cheap quote/comment-aware pre-scan for pathological bracket nesting in
 * YAML source. Counts `{`/`[` depth outside quoted scalars and comments.
 * Deliberately approximate (block scalars are not modeled) — the threshold
 * is far beyond anything legitimate config reaches.
 */
export function flowNestingTooDeep(source: string): boolean {
  let depth = 0;
  let max = 0;
  // 0 = plain, 1 = single-quoted, 2 = double-quoted, 3 = comment
  let state = 0;
  for (let i = 0; i < source.length; i += 1) {
    const c = source.charCodeAt(i);
    if (state === 1) {
      if (c === 0x27 /* ' */) state = 0;
    } else if (state === 2) {
      if (c === 0x5c /* \ */) i += 1;
      else if (c === 0x22 /* " */) state = 0;
    } else if (state === 3) {
      if (c === 0x0a /* \n */) state = 0;
    } else if (c === 0x27) state = 1;
    else if (c === 0x22) state = 2;
    else if (c === 0x23 /* # */) state = 3;
    else if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
      depth += 1;
      if (depth > max) max = depth;
      if (max > MAX_FLOW_DEPTH) return true;
    } else if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
      if (depth > 0) depth -= 1;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rebuild a parsed structure so every plain object (or Map) becomes a
 * null-prototype record. Bounded three ways, each reported as a problem:
 * - nesting deeper than `maxDepth` is replaced with `null`;
 * - any container currently on the walk path (a true CYCLE) is collapsed
 *   to `null` — `a: &a [*a, *a]` can never expand;
 * - at most MAX_NODES containers are visited in total.
 *
 * SHARED (non-cyclic) references — YAML anchors used more than once,
 * `<<: *defaults` merge blocks — are legal and each occurrence is copied.
 * That makes MAX_NODES load-bearing: with sharing allowed, the node budget
 * (incremented BEFORE recursion) is the bound on total work for any graph
 * shape, and yaml's maxAliasCount independently caps alias expansion.
 */
export function sanitize(
  value: unknown,
  maxDepth: number = MAX_DEPTH,
): { value: unknown; problems: ParseProblem[] } {
  let truncatedDepth = false;
  let collapsedCycle = false;
  let overBudget = false;
  let nodes = 0;
  const onPath = new WeakSet<object>();

  function walk(v: unknown, depth: number): unknown {
    if (v === null || typeof v !== 'object') return v;
    nodes += 1;
    if (nodes > MAX_NODES) {
      overBudget = true;
      return null;
    }
    if (onPath.has(v)) {
      collapsedCycle = true;
      return null;
    }
    if (depth >= maxDepth) {
      truncatedDepth = true;
      return null;
    }
    onPath.add(v);
    let out: unknown;
    if (Array.isArray(v)) {
      out = v.map((item) => walk(item, depth + 1));
    } else if (v instanceof Map) {
      const rec: SafeRecord = Object.create(null) as SafeRecord;
      for (const [k, item] of v) rec[String(k)] = walk(item, depth + 1);
      out = rec;
    } else if (isPlainObject(v)) {
      const rec: SafeRecord = Object.create(null) as SafeRecord;
      for (const k of Object.keys(v)) rec[k] = walk(v[k], depth + 1);
      out = rec;
    } else {
      // Non-plain object (Date, TomlDate, ...): keep as an opaque leaf.
      out = v;
    }
    // Unwind: only ancestors of the CURRENT path count as cycles, so shared
    // anchors referenced from sibling branches keep their values.
    onPath.delete(v);
    return out;
  }

  const result = walk(value, 0);
  const problems: ParseProblem[] = [];
  if (truncatedDepth) {
    problems.push(problem('$', `nesting deeper than ${maxDepth} levels was truncated`));
  }
  if (collapsedCycle) {
    problems.push(problem('$', 'cyclic references were collapsed to null'));
  }
  if (overBudget) {
    problems.push(problem('$', `structure exceeds the ${MAX_NODES}-node budget; truncated`));
  }
  return { value: result, problems };
}

/** Own enumerable string-keyed entries of a record (never walks the prototype). */
export function ownEntries(value: unknown): Array<[string, unknown]> {
  if (!isRecord(value)) return [];
  return Object.keys(value).map((k) => [k, value[k]]);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** String field reader: absent stays silent, present-but-wrong-typed reports. */
export function optionalString(
  value: unknown,
  path: string,
  problems: ParseProblem[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  problems.push(problem(path, 'expected a string'));
  return undefined;
}

/** Boolean field reader: absent stays silent, present-but-wrong-typed reports. */
export function optionalBoolean(
  value: unknown,
  path: string,
  problems: ParseProblem[],
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  problems.push(problem(path, 'expected a boolean'));
  return undefined;
}

/** Finite-number field reader: absent stays silent, wrong-typed reports. */
export function optionalNumber(
  value: unknown,
  path: string,
  problems: ParseProblem[],
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  problems.push(problem(path, 'expected a finite number'));
  return undefined;
}

/**
 * Split a comma-separated list, ignoring commas nested inside parentheses —
 * `Bash(gh issue view:*), Read` must not split inside `Bash(...)`.
 */
export function splitCommaList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')' && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Coerce a frontmatter-ish value into a string list: arrays keep their string
 * items, a bare string is comma-split. Non-string items are reported at
 * `path` and dropped.
 */
export function toStringList(value: unknown, path: string, problems: ParseProblem[]): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return splitCommaList(value);
  if (Array.isArray(value)) {
    const out: string[] = [];
    value.forEach((item, i) => {
      if (typeof item === 'string') out.push(item);
      else problems.push(problem(`${path}[${i}]`, 'expected a string'));
    });
    return out;
  }
  problems.push(problem(path, 'expected a string or list of strings'));
  return [];
}

/** Convert a record of user-controlled keys into inert `{key, value}` entries. */
export function toEnvEntries(value: unknown, path: string, problems: ParseProblem[]): EnvEntry[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    problems.push(problem(path, 'expected an object of string values'));
    return [];
  }
  const out: EnvEntry[] = [];
  for (const [key, v] of ownEntries(value)) {
    if (typeof v === 'string') out.push({ key, value: v });
    else if (typeof v === 'number' || typeof v === 'boolean') out.push({ key, value: String(v) });
    else problems.push(problem(`${path}.${key}`, 'expected a string value'));
  }
  return out;
}

const VAR_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

/** Collect `${VAR}` / `${VAR:-default}` references from a string (inert names only). */
export function collectVarRefs(value: string, into: Set<string>): void {
  for (const match of value.matchAll(VAR_REF_PATTERN)) {
    if (match[1] !== undefined) into.add(match[1]);
  }
}

/**
 * Stateful markdown code-fence filter. Call once per line; returns true when
 * the line must be skipped (a fence delimiter, or content inside a fence).
 * Tracks the opening marker so a ~~~ line cannot close a ``` fence.
 */
export function createFenceFilter(): (line: string) => boolean {
  let open: '`' | '~' | null = null;
  return (line: string): boolean => {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (match && match[1] !== undefined) {
      const marker = match[1].charAt(0) as '`' | '~';
      if (open === null) open = marker;
      else if (open === marker) open = null;
      // A mismatched fence marker inside an open fence is just content.
      return true;
    }
    return open !== null;
  };
}
