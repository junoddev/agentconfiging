import { describe, expect, it } from 'vitest';
import { tokenizeMarkdown } from './markdown.js';

describe('tokenizeMarkdown', () => {
  it('splits headings, paragraphs, and grouped list items', () => {
    const blocks = tokenizeMarkdown('# Title\n\nsome text\n\n- a\n- b');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'para', text: 'some text' },
      { kind: 'list', ordered: false, items: ['a', 'b'] },
    ]);
  });

  it('captures fenced code verbatim without reading structure inside it', () => {
    const blocks = tokenizeMarkdown('```\n# not a heading\n@not-an-import\n```');
    expect(blocks).toEqual([{ kind: 'code', text: '# not a heading\n@not-an-import' }]);
  });

  it('flushes an unterminated fence at end of input', () => {
    const blocks = tokenizeMarkdown('```\nline one\nline two');
    expect(blocks).toEqual([{ kind: 'code', text: 'line one\nline two' }]);
  });

  it('separates ordered from unordered lists and reads blockquotes', () => {
    const blocks = tokenizeMarkdown('> note\n\n1. one\n2. two');
    expect(blocks).toEqual([
      { kind: 'quote', text: 'note' },
      { kind: 'list', ordered: true, items: ['one', 'two'] },
    ]);
  });

  it('detects heading level from the number of #', () => {
    expect(tokenizeMarkdown('### Deep')).toEqual([{ kind: 'heading', level: 3, text: 'Deep' }]);
  });

  it('groups consecutive paragraph lines and joins them with newlines', () => {
    expect(tokenizeMarkdown('one\ntwo')).toEqual([{ kind: 'para', text: 'one\ntwo' }]);
  });
});
