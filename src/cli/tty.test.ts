import { describe, expect, it } from 'vitest';
import { colorEnabled, resolveRenderMode } from './tty.js';

describe('resolveRenderMode', () => {
  it('uses Ink layout only on a TTY', () => {
    expect(resolveRenderMode(true)).toBe('ink');
    expect(resolveRenderMode(false)).toBe('plain');
  });
});

describe('colorEnabled', () => {
  it('is on for a TTY without NO_COLOR', () => {
    expect(colorEnabled({}, true)).toBe(true);
  });

  it('is off when piped, regardless of env', () => {
    expect(colorEnabled({}, false)).toBe(false);
  });

  it('any non-empty NO_COLOR disables color even on a TTY', () => {
    expect(colorEnabled({ NO_COLOR: '1' }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: 'false' }, true)).toBe(false); // value is irrelevant
  });

  it('empty NO_COLOR does not disable color (no-color.org)', () => {
    expect(colorEnabled({ NO_COLOR: '' }, true)).toBe(true);
  });
});
