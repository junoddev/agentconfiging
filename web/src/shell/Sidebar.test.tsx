// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { GlobalReport, InstanceSummary, Report } from '../api/types.js';
import { buildCommands } from '../command/commands.js';
import { ROUTE_LABELS, type Route } from '../routes.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';
import { Sidebar } from './Sidebar.js';

const instances: InstanceSummary[] = [
  {
    id: 'default',
    name: 'Default',
    root: '/repo/default',
    markers: [],
    loaded: true,
    isDefault: true,
  },
];

const report: Report = {
  version: '1',
  generatedAt: 'now',
  root: '/repo/default',
  scope: 'project',
  localOnly: false,
  agents: [
    { kind: 'claude-code', confidence: 'high', files: ['.claude/settings.json'], extras: {} },
  ],
  findings: [],
  stats: { fileCount: 1, totalBytes: 128 },
};

const globalReport: GlobalReport = {
  version: '1',
  generatedAt: 'now',
  scope: 'global',
  localOnly: true,
  entries: [],
};

const deps: AppStateDeps = {
  client: {
    getInstances: async () => instances,
    getReport: async () => report,
    getGlobalReport: async () => globalReport,
    getFile: async () => ({ path: '.claude/settings.json', content: '{}', redacted: false }),
    syncInstructions: async () => ({ source: 'CLAUDE.md', targets: [], diff: '' }),
  } as unknown as ApiClient,
  makeWs: () => ({ start: () => {}, close: () => {} }),
};

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Sidebar navigation targets', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderSidebar(route: Route) {
    await act(async () => {
      root.render(
        <AppStateProvider deps={deps}>
          <Sidebar route={route} />
        </AppStateProvider>,
      );
    });
    await flush();
  }

  function link(label: string): HTMLAnchorElement {
    const anchor = Array.from(container.querySelectorAll<HTMLAnchorElement>('.nav-item')).find(
      (item) => item.textContent?.includes(label),
    );
    expect(anchor).toBeTruthy();
    return anchor!;
  }

  it('keeps active rail state while context links stay mode-aware', async () => {
    await renderSidebar({ name: 'settings' });

    expect(link('Settings').getAttribute('aria-current')).toBe('page');
    expect(link('Settings').getAttribute('href')).toBe(
      '#/settings?instance=default&agent=claude-code',
    );
    expect(link('Catalog').getAttribute('href')).toBe(
      '#/catalog?instance=default&agent=claude-code',
    );
    expect(link('Findings').getAttribute('href')).toBe('#/findings');
    expect(link('Dashboard').getAttribute('href')).toBe('#/dashboard');
    expect(link('Git').getAttribute('href')).toBe('#/git');
  });

  it('carries explicit Operate targets between Operate pages only', async () => {
    await renderSidebar({ name: 'git', target: { instanceId: 'default' } });

    expect(link('Git').getAttribute('aria-current')).toBe('page');
    expect(link('Terminal').getAttribute('href')).toBe('#/terminal?instance=default');
    expect(link('Pipelines').getAttribute('href')).toBe('#/pipelines?instance=default');
    expect(link('Settings').getAttribute('href')).toBe(
      '#/settings?instance=default&agent=claude-code',
    );
  });

  it('preserves explicit aggregate route targets for Configure and Library links', async () => {
    for (const route of [
      { name: 'findings' as const, target: { instanceId: 'deep', agentKind: 'codex' } },
      { name: 'dashboard' as const, target: { instanceId: 'deep', agentKind: 'codex' } },
    ]) {
      await renderSidebar(route);

      expect(link('Settings').getAttribute('href')).toBe('#/settings?instance=deep&agent=codex');
      expect(link('Catalog').getAttribute('href')).toBe('#/catalog?instance=deep&agent=codex');
      expect(link('Findings').getAttribute('href')).toBe('#/findings');
      expect(link('Dashboard').getAttribute('href')).toBe('#/dashboard');
      expect(link('Git').getAttribute('href')).toBe('#/git');
    }
  });

  it('uses the same labels as direct command-palette navigation', async () => {
    await renderSidebar({ name: 'overview' });

    const railLabels = Array.from(container.querySelectorAll<HTMLAnchorElement>('.nav-item')).map(
      (item) =>
        Array.from(item.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim(),
    );
    const commandLabels = new Set(
      buildCommands('light')
        .filter((command) => command.id.startsWith('nav:'))
        .map((command) => command.label),
    );

    expect(railLabels).toContain(ROUTE_LABELS.overview);
    expect(railLabels).toContain(ROUTE_LABELS.git);
    for (const label of railLabels) {
      expect(commandLabels.has(label ?? '')).toBe(true);
    }
  });
});
