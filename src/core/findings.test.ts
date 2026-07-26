import { describe, expect, it } from 'vitest';
import { slugify, sortFindings, type Finding } from './findings.js';

describe('slugify', () => {
  it('lowercases and collapses non-alphanumerics to single dashes', () => {
    expect(slugify('CLAUDE.md missing @import target')).toBe('claude-md-missing-import-target');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('  --Hooks: script not found!  ')).toBe('hooks-script-not-found');
  });

  it('is stable for identical input', () => {
    expect(slugify('Duplicate rule')).toBe(slugify('Duplicate rule'));
  });
});

describe('sortFindings', () => {
  const finding = (id: string, severity: Finding['severity']): Finding => ({
    id,
    severity,
    agent: 'claude-code',
    title: id,
    detail: '',
  });

  it('orders errors before warnings before info, then by id', () => {
    const input = [
      finding('b-warn', 'warning'),
      finding('z-info', 'info'),
      finding('a-warn', 'warning'),
      finding('c-error', 'error'),
    ];
    expect(sortFindings(input).map((f) => f.id)).toEqual(['c-error', 'a-warn', 'b-warn', 'z-info']);
  });

  it('does not mutate its input', () => {
    const input = [finding('x', 'info'), finding('y', 'error')];
    sortFindings(input);
    expect(input.map((f) => f.id)).toEqual(['x', 'y']);
  });
});
