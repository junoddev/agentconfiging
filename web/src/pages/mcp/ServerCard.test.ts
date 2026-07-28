import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServerCard } from './ServerCard.js';
import type { McpServer } from './logic.js';

const server: McpServer = {
  name: 'postgres',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'server-postgres'],
  extra: {},
};

describe('ServerCard (read-only rendering, bead 71h.4)', () => {
  it('renders no edit/remove controls when no handlers are passed (global/cloud)', () => {
    const html = renderToStaticMarkup(
      createElement(ServerCard, { server, note: 'global · read-only' }),
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('global · read-only');
    expect(html).toContain('postgres');
  });

  it('renders edit/remove controls only when handlers are passed (writable file)', () => {
    const html = renderToStaticMarkup(
      createElement(ServerCard, {
        server,
        onEdit: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(html).toContain('[EDIT]');
    expect(html).toContain('[REMOVE]');
  });
});
