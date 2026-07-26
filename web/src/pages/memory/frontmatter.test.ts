import { describe, expect, it } from 'vitest';
import { emitScalar, parseScalars, splitFrontmatter } from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('splits a fenced frontmatter block from the body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntype: user\n---\n\n# Hi\nbody');
    expect(frontmatter).toBe('type: user');
    expect(body).toBe('\n# Hi\nbody');
  });

  it('returns null frontmatter when there is no opening fence', () => {
    const r = splitFrontmatter('# Just a body\ntext');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe('# Just a body\ntext');
  });

  it('treats an unterminated opening fence as body (no valid frontmatter)', () => {
    const r = splitFrontmatter('---\ntype: user\nnever closes');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe('---\ntype: user\nnever closes');
  });

  it('normalizes CRLF line endings', () => {
    expect(splitFrontmatter('---\r\nname: a\r\n---\r\nbody').frontmatter).toBe('name: a');
  });
});

describe('parseScalars', () => {
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

  it('is resilient to malformed lines', () => {
    expect(parseScalars('not a pair\n: novalue\nname: ok')).toEqual({ name: 'ok' });
  });

  it('keeps the last value on a duplicate key', () => {
    expect(parseScalars('type: a\ntype: b').type).toBe('b');
  });
});

describe('emitScalar', () => {
  it('emits a bare scalar when safe', () => {
    expect(emitScalar('type', 'user')).toBe('type: user');
  });

  it('emits an empty scalar as key with no value', () => {
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
