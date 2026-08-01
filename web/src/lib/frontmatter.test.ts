import { describe, expect, it } from 'vitest';
import {
  asList,
  asScalar,
  emitScalar,
  getField,
  parseFrontmatter,
  parseScalars,
  splitFrontmatter,
  unquote,
} from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('splits a fenced frontmatter block from the body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ndescription: x\n---\n\n# Body');
    expect(frontmatter).toBe('description: x');
    expect(body).toBe('\n# Body');
  });

  it('returns null frontmatter for a plain markdown file', () => {
    const { frontmatter, body } = splitFrontmatter('# Just markdown\n\n- a');
    expect(frontmatter).toBeNull();
    expect(body).toBe('# Just markdown\n\n- a');
  });

  it('treats an unterminated opening fence as body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ndescription: x\n# no close');
    expect(frontmatter).toBeNull();
    expect(body).toBe('---\ndescription: x\n# no close');
  });

  it('normalizes CRLF', () => {
    expect(splitFrontmatter('---\r\nk: v\r\n---\r\nbody').frontmatter).toBe('k: v');
    expect(splitFrontmatter('---\r\nname: a\r\n---\r\nbody\r\n').body).toBe('body\n');
  });

  it('treats an empty document as bodyless with no frontmatter', () => {
    expect(splitFrontmatter('')).toEqual({ frontmatter: null, body: '' });
  });

  it('supports an empty frontmatter block', () => {
    expect(splitFrontmatter('---\n---\nx').frontmatter).toBe('');
  });
});

describe('parseFrontmatter', () => {
  it('reads scalars, inline lists, and block lists', () => {
    const fm = parseFrontmatter(
      ['description: hello', 'globs: [a, b]', 'tags:', '  - one', '  - two'].join('\n'),
    );
    expect(getField(fm, 'description')).toBe('hello');
    expect(getField(fm, 'globs')).toEqual(['a', 'b']);
    expect(getField(fm, 'tags')).toEqual(['one', 'two']);
  });

  it('strips quotes on scalars', () => {
    const e = parseFrontmatter('name: alpha\ndescription: "a b"\nmodel: \'sonnet\'');
    expect(getField(e, 'name')).toBe('alpha');
    expect(getField(e, 'description')).toBe('a b');
    expect(getField(e, 'model')).toBe('sonnet');
  });

  it('parses an empty inline flow list', () => {
    expect(getField(parseFrontmatter('tools: []'), 'tools')).toEqual([]);
  });

  it('keeps a bare comma-separated scalar unsplit (globs handled downstream)', () => {
    expect(getField(parseFrontmatter('globs: *.tsx,src/**'), 'globs')).toBe('*.tsx,src/**');
  });

  it('flattens a nested block map into subkey rows', () => {
    const e = parseFrontmatter('permissions:\n  allow:\n    - Bash\n  deny: Read');
    expect(getField(e, 'permissions')).toEqual(['allow', 'Bash', 'deny: Read']);
  });

  it('preserves entry order and keeps the last value of a duplicate key', () => {
    const e = parseFrontmatter('model: a\nx: 1\nmodel: b');
    expect(getField(e, 'model')).toBe('b');
    expect(e.map((x) => x.key)).toEqual(['model', 'x']);
  });

  it('skips comments, blanks, and malformed lines', () => {
    const fm = parseFrontmatter(['# comment', '', 'no-colon-line', 'k: v'].join('\n'));
    expect(fm.map((e) => e.key)).toEqual(['k']);
  });

  it('never throws on adversarial input', () => {
    expect(() => parseFrontmatter('::::\n---\n- \n  -\n\t\tweird')).not.toThrow();
  });
});

describe('getField (case-insensitive lookup)', () => {
  it('matches regardless of case', () => {
    const fm = parseFrontmatter('AlwaysApply: true');
    expect(getField(fm, 'alwaysapply')).toBe('true');
    expect(getField(fm, 'ALWAYSAPPLY')).toBe('true');
  });

  it('returns undefined for a missing key', () => {
    expect(getField(parseFrontmatter('a: 1'), 'b')).toBeUndefined();
  });
});

describe('unquote', () => {
  it('strips one layer of matching quotes', () => {
    expect(unquote('"x"')).toBe('x');
    expect(unquote("'y'")).toBe('y');
    expect(unquote('z')).toBe('z');
  });

  it('collapses doubled inner quotes (round-trip with emitScalar)', () => {
    expect(unquote("'it''s'")).toBe("it's");
    expect(unquote('"a""b"')).toBe('a"b');
  });
});

describe('asScalar / asList', () => {
  it('asScalar joins a list and empties undefined', () => {
    expect(asScalar(['a', 'b'])).toBe('a, b');
    expect(asScalar(undefined)).toBe('');
  });

  it('asList splits a scalar shorthand on commas, dropping blanks', () => {
    expect(asList('Read, Grep , Bash')).toEqual(['Read', 'Grep', 'Bash']);
    expect(asList(['a', '  ', 'b'])).toEqual(['a', 'b']);
    expect(asList(undefined)).toEqual([]);
  });
});

describe('parseScalars (memory scalar-only reader)', () => {
  it('reads top-level key: value scalars', () => {
    expect(parseScalars('type: user\nname: prefs\ndescription: my note')).toEqual({
      type: 'user',
      name: 'prefs',
      description: 'my note',
    });
  });

  it('strips matching quotes and collapses doubled inner quotes', () => {
    expect(parseScalars(`description: 'it''s here: yes'`)).toEqual({
      description: "it's here: yes",
    });
  });

  it('skips comments, blanks, and indented (nested) lines', () => {
    expect(parseScalars('# c\n\ntype: project\n  nested: skip')).toEqual({ type: 'project' });
  });

  it('is resilient to malformed lines and keeps the last duplicate', () => {
    expect(parseScalars('not a pair\n: novalue\nname: ok')).toEqual({ name: 'ok' });
    expect(parseScalars('type: a\ntype: b').type).toBe('b');
  });
});

describe('emitScalar (memory writer)', () => {
  it('emits a bare scalar when safe, and an empty scalar as key only', () => {
    expect(emitScalar('type', 'user')).toBe('type: user');
    expect(emitScalar('type', '')).toBe('type: ');
  });

  it('quotes values containing a colon or hash', () => {
    expect(emitScalar('description', 'ratio 3:1')).toBe("description: 'ratio 3:1'");
    expect(emitScalar('description', 'tag #ops')).toBe("description: 'tag #ops'");
  });

  it('quotes and doubles embedded single quotes', () => {
    expect(emitScalar('name', "o'brien")).toBe("name: 'o''brien'");
  });

  it('collapses newlines so a value cannot inject structure', () => {
    expect(emitScalar('description', 'a\n---\nb')).toBe("description: 'a --- b'");
  });
});
