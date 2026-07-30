import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServerDetail, ServerRow, serverSummary } from './ServerCard.js';
import type { McpServer } from './logic.js';

const server: McpServer = {
  name: 'postgres',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'server-postgres'],
  extra: {},
};

describe('ServerRow (read-only rendering, beads 71h.4 / 4u1.4)', () => {
  it('renders no edit/remove controls when no handlers are passed (global/cloud)', () => {
    const html = renderToStaticMarkup(
      createElement(ServerRow, { server, scope: 'global', scopeDetail: '~/.claude' }),
    );
    expect(html).not.toContain('Edit');
    expect(html).not.toContain('Remove');
    expect(html).toContain('GLOBAL · ~/.claude');
    expect(html).toContain('postgres');
  });

  it('renders edit/remove controls only when handlers are passed (writable file)', () => {
    const html = renderToStaticMarkup(
      createElement(ServerRow, {
        server,
        scope: 'project',
        onEdit: () => undefined,
        onRemove: () => undefined,
      }),
    );
    expect(html).toContain('Edit');
    expect(html).toContain('Remove');
  });
});

describe('serverSummary', () => {
  it('joins command + args for stdio and falls back to url for http', () => {
    expect(serverSummary(server)).toBe('npx -y server-postgres');
    expect(
      serverSummary({ name: 'x', transport: 'http', url: 'https://mcp.example', extra: {} }),
    ).toBe('https://mcp.example');
  });
});

describe('ServerDetail', () => {
  it('renders ${VAR} env values literally with a ref tag (never expanded)', () => {
    const html = renderToStaticMarkup(
      createElement(ServerDetail, {
        server: { ...server, env: { DB_URL: '${DATABASE_URL}' } },
      }),
    );
    expect(html).toContain('DB_URL');
    expect(html).toContain('${DATABASE_URL}');
    expect(html).toContain('ref · kept literal');
  });
});
