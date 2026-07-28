import { describe, expect, it } from 'vitest';
import { homeRel, pluralize } from './format.js';

describe('pluralize', () => {
  it('uses the singular form for exactly one', () => {
    expect(pluralize(1, 'finding')).toBe('1 finding');
  });

  it('uses the plural form otherwise', () => {
    expect(pluralize(0, 'finding')).toBe('0 findings');
    expect(pluralize(3, 'finding')).toBe('3 findings');
  });

  it('accepts an irregular plural', () => {
    expect(pluralize(2, 'registry', 'registries')).toBe('2 registries');
  });
});

describe('homeRel', () => {
  it('collapses a macOS home prefix', () => {
    expect(homeRel('/Users/x/.claude')).toBe('~/.claude');
  });

  it('collapses a Linux home prefix', () => {
    expect(homeRel('/home/x/.claude/settings.json')).toBe('~/.claude/settings.json');
  });

  it('collapses a bare home dir to ~', () => {
    expect(homeRel('/Users/x')).toBe('~');
  });

  it('leaves non-home paths unchanged', () => {
    expect(homeRel('/opt/x/.claude')).toBe('/opt/x/.claude');
    expect(homeRel('/Usersland/x')).toBe('/Usersland/x');
  });
});
