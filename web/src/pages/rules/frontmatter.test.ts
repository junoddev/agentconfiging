import { describe, expect, it } from 'vitest';
import { asScalar, getField, parseFrontmatter, splitFrontmatter, unquote } from './frontmatter.js';

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

  it('keeps a bare comma-separated scalar unsplit (globs handled downstream)', () => {
    const fm = parseFrontmatter('globs: *.tsx,src/**');
    expect(getField(fm, 'globs')).toBe('*.tsx,src/**');
  });

  it('skips comments, blanks, and malformed lines', () => {
    const fm = parseFrontmatter(['# comment', '', 'no-colon-line', 'k: v'].join('\n'));
    expect(fm.map((e) => e.key)).toEqual(['k']);
  });

  it('is case-insensitive on lookup', () => {
    const fm = parseFrontmatter('AlwaysApply: true');
    expect(getField(fm, 'alwaysapply')).toBe('true');
  });
});

describe('unquote / asScalar', () => {
  it('strips one layer of matching quotes', () => {
    expect(unquote('"x"')).toBe('x');
    expect(unquote("'y'")).toBe('y');
    expect(unquote('z')).toBe('z');
  });

  it('joins list values for display', () => {
    expect(asScalar(['a', 'b'])).toBe('a, b');
    expect(asScalar(undefined)).toBe('');
  });
});
