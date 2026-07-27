/**
 * Templating tests (bead ira.1). Proves {{input}}/{{NodeName}} substitution is
 * pure STRING replacement and NEVER code execution — the KEY no-eval property:
 * code-like content in a template or in a resolved value is DATA, never run.
 */

import { describe, expect, it } from 'vitest';
import { extractRefs, resolveTemplate, stringifyValue } from './template.js';

describe('resolveTemplate', () => {
  const ctx = { input: 'IN', outputs: { Fetch: 'BODY', Node2: { a: 1 } } };

  it('substitutes {{input}} and {{NodeName}}', () => {
    expect(resolveTemplate('x={{input}} y={{Fetch}}', ctx)).toBe('x=IN y=BODY');
  });

  it('trims whitespace inside braces', () => {
    expect(resolveTemplate('{{  Fetch  }}', ctx)).toBe('BODY');
  });

  it('JSON-serializes non-string outputs', () => {
    expect(resolveTemplate('{{Node2}}', ctx)).toBe('{"a":1}');
  });

  it('resolves an unknown reference to empty string (never throws)', () => {
    expect(resolveTemplate('a{{Missing}}b', ctx)).toBe('ab');
  });

  it('does NOT walk the prototype chain for a reference', () => {
    // `constructor`/`toString` exist on the prototype but are not own outputs.
    expect(resolveTemplate('{{constructor}}{{toString}}', ctx)).toBe('');
  });

  it('NO EVAL: code-like template content is inert text, not executed', () => {
    // Code-like content is never evaluated. Parens are outside the reference
    // charset, so this is not even a reference — it is left verbatim as inert
    // text (definitely not executed).
    const evilCtx = { input: 'IN', outputs: {} };
    expect(resolveTemplate('{{process.exit(1)}}', evilCtx)).toBe('{{process.exit(1)}}');
    // A charset-valid name that is not an own output resolves to '' (a lookup
    // miss), never a prototype method call.
    expect(resolveTemplate('{{__proto__}}', evilCtx)).toBe('');
    // A value that LOOKS like code is substituted verbatim as data.
    const dataCtx = { input: '`rm -rf /`; $(whoami)', outputs: {} };
    expect(resolveTemplate('[{{input}}]', dataCtx)).toBe('[`rm -rf /`; $(whoami)]');
  });
});

describe('extractRefs', () => {
  it('returns deduped reference names in order', () => {
    expect(extractRefs('{{input}} {{A}} {{A}} {{B}}')).toEqual(['input', 'A', 'B']);
  });
  it('returns [] when there are no references', () => {
    expect(extractRefs('plain text')).toEqual([]);
  });
});

describe('stringifyValue', () => {
  it('passes strings through and empties null/undefined', () => {
    expect(stringifyValue('s')).toBe('s');
    expect(stringifyValue(null)).toBe('');
    expect(stringifyValue(undefined)).toBe('');
  });
  it('serializes objects/numbers', () => {
    expect(stringifyValue({ a: 1 })).toBe('{"a":1}');
    expect(stringifyValue(42)).toBe('42');
  });
});
