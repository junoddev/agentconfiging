import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WriteFlow } from './WriteFlow.js';
import type { WriteFlowController, WritePreview } from './useWriteFlow.js';

const WARNING_TEXT = 'AFFECTS ALL PROJECTS AND AGENTS ON THIS MACHINE';

function preview(overrides: Partial<WritePreview>): WritePreview {
  return {
    path: '.claude/settings.json',
    pathScope: 'project',
    willCreate: false,
    willModify: true,
    hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'add', text: 'x' }] }],
    ...overrides,
  };
}

function readyFlow(previews: WritePreview[]): WriteFlowController {
  return {
    phase: 'ready',
    request: { kind: 'file', path: previews[0]?.path ?? 'x', content: '' },
    previews,
    begin: () => undefined,
    commit: () => undefined,
    cancel: () => undefined,
  };
}

describe('WriteFlow global-scope warning (bead 71h.10)', () => {
  it('renders the warn banner + [COMMIT — ALL PROJECTS] when a preview is global', () => {
    const html = renderToStaticMarkup(
      createElement(WriteFlow, {
        flow: readyFlow([preview({ path: '/Users/x/.claude/settings.json', pathScope: 'global' })]),
      }),
    );
    expect(html).toContain('GLOBAL SCOPE — EDITS ~/.claude/settings.json');
    expect(html).toContain(WARNING_TEXT);
    expect(html).toContain('[COMMIT — ALL PROJECTS]');
    expect(html).not.toContain('[COMMIT]');
  });

  it('renders no banner and the plain [COMMIT] for a project-scope preview', () => {
    const html = renderToStaticMarkup(createElement(WriteFlow, { flow: readyFlow([preview({})]) }));
    expect(html).not.toContain('GLOBAL SCOPE');
    expect(html).not.toContain(WARNING_TEXT);
    expect(html).toContain('[COMMIT]');
    expect(html).not.toContain('[COMMIT — ALL PROJECTS]');
  });

  it('warns when ANY edit of a multi-file preview is global (apply-fix path)', () => {
    const html = renderToStaticMarkup(
      createElement(WriteFlow, {
        flow: readyFlow([
          preview({}),
          preview({ path: '/Users/x/.claude/CLAUDE.md', pathScope: 'global' }),
        ]),
      }),
    );
    expect(html).toContain(WARNING_TEXT);
    expect(html).toContain('[COMMIT — ALL PROJECTS]');
  });
});
