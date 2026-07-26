import { describe, expect, it } from 'vitest';
import {
  buildBinding,
  buildResetContent,
  bindingToConfig,
  chordSteps,
  contentHasRedactionMarks,
  emptyBinding,
  invalidReason,
  isChord,
  isRedacted,
  parseBinding,
  parseKeybindings,
  removeBinding,
  serializeKeybindings,
  STARTER_BINDINGS,
  upsertBinding,
  type Binding,
  type ParsedKeybindings,
} from './logic.js';

/** Mirrors fixtures/trees/claude-rich/.claude/keybindings.json. */
const RICH = JSON.stringify({
  bindings: [
    { context: 'chat', key: 'ctrl+j', command: 'chat.insertNewline' },
    { context: 'chat', key: 'ctrl+g ctrl+s', command: 'git.status' },
    { context: 'global', key: 'ctrl+t', command: 'todos.toggle' },
  ],
});

describe('parseKeybindings', () => {
  it('parses the wrapper-object shape from the fixture', () => {
    const res = parseKeybindings(RICH);
    expect(res.parseError).toBe(false);
    expect(res.shape).toBe('object');
    expect(res.hasBindings).toBe(true);
    expect(res.bindings).toHaveLength(3);
    expect(res.bindings[0]).toEqual({
      key: 'ctrl+j',
      command: 'chat.insertNewline',
      condition: 'chat',
      conditionKey: 'context',
      extra: {},
    });
  });

  it('parses a top-level array shape', () => {
    const res = parseKeybindings(JSON.stringify([{ key: 'ctrl+t', command: 'x' }]));
    expect(res.shape).toBe('array');
    expect(res.doc).toBeNull();
    expect(res.hasBindings).toBe(true);
    expect(res.bindings[0]?.command).toBe('x');
  });

  it('reports malformed JSON without throwing', () => {
    const res = parseKeybindings('{ not json');
    expect(res.parseError).toBe(true);
    expect(res.bindings).toEqual([]);
  });

  it('treats an object without a bindings array as valid but empty', () => {
    const res = parseKeybindings(JSON.stringify({ version: 2 }));
    expect(res.parseError).toBe(false);
    expect(res.hasBindings).toBe(false);
    expect(res.bindings).toEqual([]);
    expect(res.doc).toEqual({ version: 2 });
  });

  it('yields nothing usable for a non-object, non-array top level', () => {
    const res = parseKeybindings('42');
    expect(res.parseError).toBe(false);
    expect(res.hasBindings).toBe(false);
    expect(res.bindings).toEqual([]);
  });

  it('recognizes a condition under when / condition, not just context', () => {
    const res = parseKeybindings(
      JSON.stringify({ bindings: [{ key: 'a', command: 'c', when: 'editorFocus' }] }),
    );
    expect(res.bindings[0]?.condition).toBe('editorFocus');
    expect(res.bindings[0]?.conditionKey).toBe('when');
  });

  it('skips malformed (non-object) binding entries', () => {
    const res = parseKeybindings(
      JSON.stringify({ bindings: ['nope', 5, null, { key: 'a', command: 'c' }] }),
    );
    expect(res.bindings).toHaveLength(1);
    expect(res.bindings[0]?.key).toBe('a');
  });

  it('renders adversarial combo/command text verbatim (no execution, no escaping)', () => {
    const nasty = '<script>$(rm -rf /)</script>; `id`';
    const res = parseKeybindings(JSON.stringify({ bindings: [{ key: nasty, command: nasty }] }));
    expect(res.bindings[0]?.key).toBe(nasty);
    expect(res.bindings[0]?.command).toBe(nasty);
  });
});

describe('parseBinding — unknown-key preservation', () => {
  it('preserves keys the model does not understand under extra', () => {
    const b = parseBinding({ key: 'a', command: 'c', args: ['x'], mac: 'cmd+a' });
    expect(b?.extra).toEqual({ args: ['x'], mac: 'cmd+a' });
  });

  it('returns null for a non-object', () => {
    expect(parseBinding('x')).toBeNull();
    expect(parseBinding(null)).toBeNull();
  });
});

describe('bindingToConfig + serialize round-trip', () => {
  it('round-trips the fixture value-equal (fields + order + unknown keys)', () => {
    const parsed = parseKeybindings(RICH);
    const out = serializeKeybindings(parsed, parsed.bindings);
    expect(JSON.parse(out)).toEqual(JSON.parse(RICH));
    expect(out.endsWith('\n')).toBe(true);
  });

  it('preserves a preserved extra key across a round-trip', () => {
    const src = JSON.stringify({ bindings: [{ key: 'a', command: 'c', mac: 'cmd+a' }] });
    const parsed = parseKeybindings(src);
    const out = serializeKeybindings(parsed, parsed.bindings);
    expect(JSON.parse(out)).toEqual({ bindings: [{ key: 'a', command: 'c', mac: 'cmd+a' }] });
  });

  it('preserves non-bindings top-level keys (object shape)', () => {
    const src = JSON.stringify({ $schema: './kb.schema.json', bindings: [] });
    const parsed = parseKeybindings(src);
    const out = JSON.parse(serializeKeybindings(parsed, parsed.bindings)) as Record<
      string,
      unknown
    >;
    expect(out['$schema']).toBe('./kb.schema.json');
  });

  it('emits an array document for the array shape', () => {
    const parsed = parseKeybindings(JSON.stringify([{ key: 'a', command: 'c' }]));
    const out = JSON.parse(serializeKeybindings(parsed, parsed.bindings));
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([{ key: 'a', command: 'c' }]);
  });

  it('emits the condition under its original key name', () => {
    const b: Binding = { key: 'a', command: 'c', condition: 'x', conditionKey: 'when', extra: {} };
    expect(bindingToConfig(b)).toEqual({ when: 'x', key: 'a', command: 'c' });
  });

  it('two-space indent with a trailing newline', () => {
    const parsed = parseKeybindings('{}');
    const out = serializeKeybindings(parsed, [{ key: 'a', command: 'c', extra: {} }]);
    expect(out).toContain('\n  "bindings"');
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('upsertBinding / removeBinding', () => {
  const list: Binding[] = [
    { key: 'a', command: 'ca', extra: {} },
    { key: 'b', command: 'cb', extra: {} },
  ];

  it('appends when no index is given', () => {
    const next = upsertBinding(list, { key: 'c', command: 'cc', extra: {} });
    expect(next).toHaveLength(3);
    expect(next[2]?.key).toBe('c');
  });

  it('replaces at an index without disturbing siblings', () => {
    const next = upsertBinding(list, { key: 'B2', command: 'cb2', extra: {} }, 1);
    expect(next.map((b) => b.key)).toEqual(['a', 'B2']);
  });

  it('removes at an index', () => {
    expect(removeBinding(list, 0).map((b) => b.key)).toEqual(['b']);
  });

  it('is a safe no-op for out-of-range removal', () => {
    expect(removeBinding(list, 9)).toHaveLength(2);
  });
});

describe('chord helpers', () => {
  it('splits a chorded combo into steps', () => {
    expect(chordSteps('ctrl+g ctrl+s')).toEqual(['ctrl+g', 'ctrl+s']);
    expect(chordSteps('  ctrl+t  ')).toEqual(['ctrl+t']);
    expect(chordSteps('')).toEqual([]);
  });

  it('flags multi-step chords only', () => {
    expect(isChord('ctrl+g ctrl+s')).toBe(true);
    expect(isChord('ctrl+t')).toBe(false);
    expect(isChord('')).toBe(false);
  });
});

describe('redaction detection (save trap — dual signal)', () => {
  it('flags spans present', () => {
    expect(isRedacted([{ start: 1, end: 2, id: 'openai' }])).toBe(true);
    expect(isRedacted([])).toBe(false);
  });

  it('scans raw content for a redaction mark independently of spans', () => {
    expect(contentHasRedactionMarks('"command": "[REDACTED:github]"')).toBe(true);
    expect(contentHasRedactionMarks('"command": "git.status"')).toBe(false);
  });
});

describe('buildBinding / invalidReason (form → model)', () => {
  it('builds a binding and omits a blank condition', () => {
    const b = buildBinding({ key: ' ctrl+t ', command: ' todos.toggle ', condition: '  ' });
    expect(b).toEqual({ key: 'ctrl+t', command: 'todos.toggle', extra: {} });
  });

  it('carries a seed binding’s extra and condition key through unchanged', () => {
    const seed: Binding = {
      key: 'a',
      command: 'c',
      condition: 'chat',
      conditionKey: 'when',
      extra: { mac: 'cmd+a' },
    };
    const b = buildBinding({ key: 'a', command: 'c2', condition: 'global', seed });
    expect(b.extra).toEqual({ mac: 'cmd+a' });
    expect(b.conditionKey).toBe('when');
    expect(b.condition).toBe('global');
  });

  it('requires a combo and a command', () => {
    expect(invalidReason({ key: '', command: 'x' })).toMatch(/combo/);
    expect(invalidReason({ key: 'a', command: '' })).toMatch(/command/);
    expect(invalidReason({ key: 'a', command: 'x' })).toBeUndefined();
  });

  it('emptyBinding is a blank editable value', () => {
    expect(emptyBinding()).toEqual({ key: '', command: '', extra: {} });
  });
});

describe('buildResetContent (reset to starter set)', () => {
  it('produces the documented starter bindings and parses back cleanly', () => {
    const parsed = parseKeybindings('{}');
    const out = buildResetContent(parsed);
    const reparsed = parseKeybindings(out);
    expect(reparsed.bindings).toHaveLength(STARTER_BINDINGS.length);
    expect(reparsed.bindings.map((b) => b.command)).toEqual(STARTER_BINDINGS.map((b) => b.command));
    expect(out.endsWith('\n')).toBe(true);
  });

  it('preserves non-bindings wrapper keys when resetting', () => {
    const parsed = parseKeybindings(JSON.stringify({ version: 3, bindings: [] }));
    const out = JSON.parse(buildResetContent(parsed)) as Record<string, unknown>;
    expect(out['version']).toBe(3);
    expect(Array.isArray(out['bindings'])).toBe(true);
  });

  it('keeps the array shape when the source was an array', () => {
    const parsed: ParsedKeybindings = {
      bindings: [],
      doc: null,
      shape: 'array',
      parseError: false,
      hasBindings: true,
    };
    const out = JSON.parse(buildResetContent(parsed));
    expect(Array.isArray(out)).toBe(true);
  });
});
