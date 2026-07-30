import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scopeClass, sourceBadgeText } from './badge.js';
import { SourceBadge } from './SourceBadge.js';

describe('sourceBadgeText', () => {
  it('renders the bare scope', () => {
    expect(sourceBadgeText('project')).toBe('PROJECT');
  });

  it('appends a detail with a mid-dot', () => {
    expect(sourceBadgeText('local', 'gitignored')).toBe('LOCAL · gitignored');
  });

  it('appends detail and READ-ONLY for global', () => {
    expect(sourceBadgeText('global', '~/.claude', true)).toBe('GLOBAL · ~/.claude · READ-ONLY');
  });

  it('skips an empty detail but keeps READ-ONLY', () => {
    expect(sourceBadgeText('global', '', true)).toBe('GLOBAL · READ-ONLY');
  });
});

describe('scopeClass', () => {
  it('maps every scope to its Console contract class', () => {
    expect(scopeClass('project')).toBe('s-project');
    expect(scopeClass('global')).toBe('s-global');
    expect(scopeClass('local')).toBe('s-local');
    expect(scopeClass('default')).toBe('s-default');
  });
});

describe('SourceBadge', () => {
  it('renders a .scope contract span with the composed text', () => {
    const html = renderToStaticMarkup(
      createElement(SourceBadge, { scope: 'global', detail: '~/.claude', readOnly: true }),
    );
    expect(html).toBe(
      '<span class="scope s-global source-badge">GLOBAL · ~/.claude · READ-ONLY</span>',
    );
  });

  it('renders the bare scope without separators', () => {
    const html = renderToStaticMarkup(createElement(SourceBadge, { scope: 'project' }));
    expect(html).toBe('<span class="scope s-project source-badge">PROJECT</span>');
  });
});
