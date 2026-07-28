import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { sourceBadgeText } from './badge.js';
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

describe('SourceBadge', () => {
  it('renders a micro-label span with the composed text', () => {
    const html = renderToStaticMarkup(
      createElement(SourceBadge, { scope: 'global', detail: '~/.claude', readOnly: true }),
    );
    expect(html).toBe(
      '<span class="source-badge micro-label">GLOBAL · ~/.claude · READ-ONLY</span>',
    );
  });

  it('renders the bare scope without separators', () => {
    const html = renderToStaticMarkup(createElement(SourceBadge, { scope: 'project' }));
    expect(html).toBe('<span class="source-badge micro-label">PROJECT</span>');
  });
});
