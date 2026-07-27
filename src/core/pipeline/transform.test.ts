/**
 * Safe declarative-operation tests (bead ira.1) for transform / filter /
 * json-extract. KEY security property: these reshape DATA only — no eval, no
 * Function — and refuse prototype-pollution keys.
 */

import { describe, expect, it } from 'vitest';
import { applyFilter, applyTransform, coerceJsonInput, extractJsonPath } from './transform.js';

describe('applyTransform', () => {
  it('pick keeps only listed keys', () => {
    expect(applyTransform({ a: 1, b: 2, c: 3 }, [{ op: 'pick', keys: ['a', 'c'] }])).toEqual({
      a: 1,
      c: 3,
    });
  });
  it('omit drops listed keys', () => {
    expect(applyTransform({ a: 1, b: 2 }, [{ op: 'omit', keys: ['b'] }])).toEqual({ a: 1 });
  });
  it('rename moves a key', () => {
    expect(applyTransform({ a: 1 }, [{ op: 'rename', from: 'a', to: 'z' }])).toEqual({ z: 1 });
  });
  it('set writes a literal string', () => {
    expect(applyTransform({}, [{ op: 'set', key: 'k', value: 'v' }])).toEqual({ k: 'v' });
  });
  it('non-object input starts from an empty object', () => {
    expect(applyTransform('nope', [{ op: 'set', key: 'k', value: 'v' }])).toEqual({ k: 'v' });
  });
  it('NO PROTO POLLUTION: forbidden keys are refused, not written', () => {
    const out = applyTransform({}, [
      { op: 'set', key: '__proto__', value: 'polluted' },
      { op: 'set', key: 'constructor', value: 'x' },
    ]);
    expect(out).toEqual({});
    // The Object prototype was NOT mutated.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('applyFilter', () => {
  const rows = [
    { name: 'a', n: 1 },
    { name: 'b', n: 5 },
    { name: 'c', n: 9 },
  ];
  it('filters an array by eq', () => {
    expect(applyFilter(rows, { field: 'name', op: 'eq', value: 'b' })).toEqual([
      { name: 'b', n: 5 },
    ]);
  });
  it('filters by gt', () => {
    expect(applyFilter(rows, { field: 'n', op: 'gt', value: 4 })).toEqual([
      { name: 'b', n: 5 },
      { name: 'c', n: 9 },
    ]);
  });
  it('contains does substring matching', () => {
    expect(applyFilter([{ s: 'hello' }], { field: 's', op: 'contains', value: 'ell' })).toEqual([
      { s: 'hello' },
    ]);
  });
  it('exists checks presence', () => {
    expect(applyFilter([{ a: 1 }, { b: 2 }], { field: 'a', op: 'exists' })).toEqual([{ a: 1 }]);
  });
  it('a scalar passes through iff it matches, else null', () => {
    expect(applyFilter(5, { field: '', op: 'gt', value: 3 })).toBe(5);
    expect(applyFilter(2, { field: '', op: 'gt', value: 3 })).toBeNull();
  });
});

describe('extractJsonPath', () => {
  const doc = { a: { b: [{ c: 42 }] }, list: [10, 20] };
  it('traverses dotted + indexed paths', () => {
    expect(extractJsonPath(doc, 'a.b[0].c')).toBe(42);
    expect(extractJsonPath(doc, 'list[1]')).toBe(20);
  });
  it('returns undefined for a missing path', () => {
    expect(extractJsonPath(doc, 'a.x.y')).toBeUndefined();
  });
  it('refuses prototype keys', () => {
    expect(extractJsonPath(doc, '__proto__')).toBeUndefined();
    expect(extractJsonPath(doc, 'a.constructor')).toBeUndefined();
  });
  it('empty path returns the whole value', () => {
    expect(extractJsonPath(doc, '')).toBe(doc);
  });
});

describe('coerceJsonInput', () => {
  it('parses a JSON string', () => {
    expect(coerceJsonInput('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns a non-JSON string as-is', () => {
    expect(coerceJsonInput('plain')).toBe('plain');
  });
  it('returns non-strings unchanged', () => {
    const obj = { a: 1 };
    expect(coerceJsonInput(obj)).toBe(obj);
  });
});
