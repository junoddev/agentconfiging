import { describe, expect, it } from 'vitest';
import { diffLineClass, diffLinePrefix } from './diff.js';

describe('diffLineClass', () => {
  it('maps add and del lines onto their colored modifiers', () => {
    expect(diffLineClass('add')).toBe('diff__line diff__line--add');
    expect(diffLineClass('del')).toBe('diff__line diff__line--del');
  });

  it('leaves context lines unmodified', () => {
    expect(diffLineClass('ctx')).toBe('diff__line');
  });
});

describe('diffLinePrefix', () => {
  it('maps line kinds onto unified-diff markers', () => {
    expect(diffLinePrefix('add')).toBe('+');
    expect(diffLinePrefix('del')).toBe('-');
    expect(diffLinePrefix('ctx')).toBe(' ');
  });
});
