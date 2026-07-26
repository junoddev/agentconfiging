import { describe, expect, it } from 'vitest';
import { asList, asScalar, getField, parseFrontmatter, splitFrontmatter } from './frontmatter.js';

describe('splitFrontmatter', () => {
  it('splits a document with a leading fence', () => {
    const { frontmatter, body } = splitFrontmatter('---\nname: a\n---\nbody line\n');
    expect(frontmatter).toBe('name: a');
    expect(body).toBe('body line\n');
  });

  it('returns null frontmatter when the doc does not start with a fence', () => {
    const { frontmatter, body } = splitFrontmatter('# just markdown\ntext');
    expect(frontmatter).toBeNull();
    expect(body).toBe('# just markdown\ntext');
  });

  it('returns null when the opening fence never closes', () => {
    const src = '---\nname: a\nno close here';
    const { frontmatter, body } = splitFrontmatter(src);
    expect(frontmatter).toBeNull();
    expect(body).toBe(src);
  });

  it('handles CRLF line endings', () => {
    const { frontmatter, body } = splitFrontmatter('---\r\nname: a\r\n---\r\nbody\r\n');
    expect(frontmatter).toBe('name: a');
    expect(body).toBe('body\n');
  });

  it('treats an empty document as bodyless with no frontmatter', () => {
    expect(splitFrontmatter('')).toEqual({ frontmatter: null, body: '' });
  });

  it('supports an empty frontmatter block', () => {
    const { frontmatter } = splitFrontmatter('---\n---\nx');
    expect(frontmatter).toBe('');
  });
});

describe('parseFrontmatter', () => {
  it('parses scalars and strips quotes', () => {
    const e = parseFrontmatter('name: alpha\ndescription: "a b"\nmodel: \'sonnet\'');
    expect(getField(e, 'name')).toBe('alpha');
    expect(getField(e, 'description')).toBe('a b');
    expect(getField(e, 'model')).toBe('sonnet');
  });

  it('parses inline flow lists', () => {
    const e = parseFrontmatter('tools: [Read, "Grep", Bash]');
    expect(getField(e, 'tools')).toEqual(['Read', 'Grep', 'Bash']);
  });

  it('parses an empty inline flow list', () => {
    expect(getField(parseFrontmatter('tools: []'), 'tools')).toEqual([]);
  });

  it('parses block lists under an empty-value key', () => {
    const e = parseFrontmatter('tools:\n  - Read\n  - Grep\nmodel: opus');
    expect(getField(e, 'tools')).toEqual(['Read', 'Grep']);
    expect(getField(e, 'model')).toBe('opus');
  });

  it('flattens a nested block map into subkey rows', () => {
    const e = parseFrontmatter('permissions:\n  allow:\n    - Bash\n  deny: Read');
    // deep nesting is flattened, not modelled
    expect(getField(e, 'permissions')).toEqual(['allow', 'Bash', 'deny: Read']);
  });

  it('preserves entry order', () => {
    const e = parseFrontmatter('b: 1\na: 2\nc: 3');
    expect(e.map((x) => x.key)).toEqual(['b', 'a', 'c']);
  });

  it('keeps the last value for a duplicate key at its first position', () => {
    const e = parseFrontmatter('model: a\nx: 1\nmodel: b');
    expect(getField(e, 'model')).toBe('b');
    expect(e.map((x) => x.key)).toEqual(['model', 'x']);
  });

  it('skips comments, blanks, and malformed lines', () => {
    const e = parseFrontmatter('# comment\n\nname: ok\nthis line has no colon\n:leadingcolon');
    expect(e).toHaveLength(1);
    expect(getField(e, 'name')).toBe('ok');
  });

  it('is resilient to an empty block value', () => {
    const e = parseFrontmatter('tools:\nname: x');
    expect(getField(e, 'tools')).toEqual([]);
    expect(getField(e, 'name')).toBe('x');
  });

  it('never throws on adversarial input', () => {
    expect(() => parseFrontmatter('::::\n---\n- \n  -\n\t\tweird')).not.toThrow();
  });
});

describe('asList / asScalar', () => {
  it('asList splits a scalar shorthand on commas', () => {
    expect(asList('Read, Grep , Bash')).toEqual(['Read', 'Grep', 'Bash']);
  });
  it('asList passes arrays through, dropping blanks', () => {
    expect(asList(['a', '  ', 'b'])).toEqual(['a', 'b']);
  });
  it('asList of undefined is empty', () => {
    expect(asList(undefined)).toEqual([]);
  });
  it('asScalar joins an array', () => {
    expect(asScalar(['a', 'b'])).toBe('a, b');
  });
  it('asScalar of undefined is empty string', () => {
    expect(asScalar(undefined)).toBe('');
  });
});
