/**
 * pipeline/transform — the SAFE, declarative subset behind the transform /
 * filter / json-extract nodes (SPEC §5 row 12, bead agentconfig-ira.1).
 *
 * SECURITY-CRITICAL, THE NO-EVAL RULE: none of these functions ever evaluate a
 * user string as code. There is no eval, no Function, no `new Function`, no VM,
 * no template-string execution. Every operation is a FIXED, enumerated reshape
 * of plain JSON data selected by a discriminant (`op`) — the user chooses WHICH
 * safe operation runs and supplies DATA (keys, a field name, a literal value, a
 * dotted path); the user never supplies logic. A fully-general "run this
 * expression" transform is intentionally NOT offered, because it could not be
 * made safe without eval. This is the documented safe subset.
 *
 * PROTOTYPE-POLLUTION GUARD: object writes refuse the dangerous keys
 * (`__proto__`, `prototype`, `constructor`) so a crafted key can never mutate a
 * prototype. Reads walk own-properties only.
 *
 *  - applyTransform(value, ops): pick / omit / rename / set over a JSON object.
 *  - applyFilter(value, predicate): keep array elements (or a scalar) matching a
 *    fixed comparison.
 *  - extractJsonPath(value, path): safe dotted/indexed traversal (a.b[0].c).
 */

import type { FilterPredicate, TransformOp } from './types.js';

/** Keys that must never be written (prototype-pollution vectors). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/** A plain (non-array, non-null) object — the shape transforms reshape. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Own-property read (never the prototype chain). */
function ownGet(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

/** Safe write: refuse forbidden keys so no prototype can be polluted. */
function safeSet(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (FORBIDDEN_KEYS.has(key)) return;
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Apply a sequence of safe transform operations to a JSON value. A non-object
 * input starts from an empty object (documented) — transforms reshape objects.
 * `set` values are literal strings (the runtime templates them as DATA before
 * calling this pure function).
 */
export function applyTransform(value: unknown, ops: TransformOp[]): Record<string, unknown> {
  let obj: Record<string, unknown> = isPlainObject(value) ? { ...value } : {};
  for (const op of ops) {
    switch (op.op) {
      case 'pick': {
        const next: Record<string, unknown> = {};
        for (const key of op.keys) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) safeSet(next, key, obj[key]);
        }
        obj = next;
        break;
      }
      case 'omit': {
        const drop = new Set(op.keys);
        const next: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
          if (!drop.has(key)) safeSet(next, key, obj[key]);
        }
        obj = next;
        break;
      }
      case 'rename': {
        if (Object.prototype.hasOwnProperty.call(obj, op.from)) {
          const v = obj[op.from];
          delete obj[op.from];
          safeSet(obj, op.to, v);
        }
        break;
      }
      case 'set': {
        safeSet(obj, op.key, op.value);
        break;
      }
    }
  }
  return obj;
}

/** Compare one field of an element against a literal by a fixed operator. */
function matchPredicate(element: unknown, predicate: FilterPredicate): boolean {
  const { field, op, value } = predicate;
  const fieldValue =
    field === '' ? element : isPlainObject(element) ? ownGet(element, field) : undefined;
  switch (op) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'eq':
      return fieldValue === value;
    case 'ne':
      return fieldValue !== value;
    case 'contains':
      return String(fieldValue).includes(String(value));
    case 'gt':
      return Number(fieldValue) > Number(value);
    case 'lt':
      return Number(fieldValue) < Number(value);
    default:
      return false;
  }
}

/**
 * Filter by a safe predicate. An array is filtered element-wise; any other
 * value passes through iff it matches (else `null`, a blocked signal). No eval.
 */
export function applyFilter(value: unknown, predicate: FilterPredicate): unknown {
  if (Array.isArray(value)) return value.filter((el) => matchPredicate(el, predicate));
  return matchPredicate(value, predicate) ? value : null;
}

/** Tokenize `a.b[0].c` into ['a','b','0','c']. Rejects nothing structurally —
 *  unmatched text simply yields no traversal step. */
function pathTokens(path: string): string[] {
  const out: string[] = [];
  for (const match of path.matchAll(/[^.[\]]+|\[(\d+)\]/g)) {
    out.push(match[1] ?? match[0]);
  }
  return out;
}

/**
 * Safe dotted/indexed traversal of a JSON value (e.g. `a.b[0].c`). Own-property
 * reads and numeric array indexing only — never eval, never a prototype walk.
 * A missing/blocked step yields `undefined`.
 */
export function extractJsonPath(value: unknown, path: string): unknown {
  if (typeof path !== 'string' || path.trim() === '') return value;
  let current: unknown = value;
  for (const token of pathTokens(path)) {
    if (current === null || current === undefined) return undefined;
    if (FORBIDDEN_KEYS.has(token)) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0) return undefined;
      current = current[idx];
    } else if (isPlainObject(current)) {
      current = ownGet(current, token);
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Coerce a node input into a JSON value for extraction/transform: a string is
 * parsed as JSON when possible (e.g. an http body), otherwise returned as-is.
 * Guarded parse — never throws, never executes.
 */
export function coerceJsonInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
