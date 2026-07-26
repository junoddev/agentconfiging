import { describe, expect, it } from 'vitest';
import { pluralize } from './format.js';

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
