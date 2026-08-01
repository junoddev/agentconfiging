// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { InstanceSummary, Report } from '../api/types.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';
import { TopBar } from './TopBar.js';

const instance: InstanceSummary = {
  id: 'default',
  name: 'project',
  root: '/project',
  markers: [],
  loaded: true,
  isDefault: true,
};

const report: Report = {
  version: '1',
  generatedAt: 'now',
  root: '/project',
  scope: 'project',
  localOnly: false,
  agents: [
    { kind: 'claude-code', confidence: 'high', files: ['.claude/settings.json'], extras: {} },
  ],
  findings: [],
  stats: { fileCount: 0, totalBytes: 0 },
};

const deps: AppStateDeps = {
  client: {
    getInstances: async () => [instance],
    getReport: async () => report,
    getGlobalReport: async () => ({ entries: [] }),
  } as unknown as ApiClient,
  makeWs: () => ({ start: () => {}, close: () => {} }),
};

describe('TopBar folder picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderTopBar(route?: Parameters<typeof TopBar>[0]['route']) {
    await act(async () => {
      root.render(
        <AppStateProvider deps={deps}>
          <TopBar
            route={route}
            theme="dark"
            onToggleTheme={() => {}}
            onAbout={() => {}}
            onToggleNav={() => {}}
          />
        </AppStateProvider>,
      );
      await Promise.resolve();
    });
  }

  it('offers Add new and navigates to the Instances tab', async () => {
    await renderTopBar();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ch-side')?.click();
    });

    const addNew = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((button) => button.textContent?.includes('Add new'));
    expect(addNew).toBeDefined();

    await act(async () => addNew?.click());

    expect(window.location.hash).toBe('#/instances');
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('shows chooser semantics only for Configure and Library', async () => {
    const chooserRoutes = [
      { name: 'settings' as const, label: 'Configuration context' },
      { name: 'catalog' as const, label: 'Library context' },
    ];

    for (const { name, label } of chooserRoutes) {
      await renderTopBar({ name });
      const chooser = container.querySelector('.chooser');
      expect(chooser?.getAttribute('aria-label')).toBe(label);
      expect(container.querySelector('.mode-context')).toBeNull();
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>('.ch-side')).map((button) =>
          button.getAttribute('aria-label'),
        ),
      ).toEqual([`${label} folder: project`, `${label} agent: Claude Code`]);
    }
  });

  it('replaces the chooser with explicit mode copy for Workspace, Runtime, and Operate', async () => {
    const modes = [
      { route: { name: 'overview' as const }, label: 'Workspace mode: Aggregate view' },
      { route: { name: 'dashboard' as const }, label: 'Runtime mode: Aggregate activity' },
      { route: { name: 'git' as const }, label: 'Operate mode: Target selected in page' },
    ];

    for (const { route, label } of modes) {
      await renderTopBar(route);
      expect(container.querySelector('.chooser')).toBeNull();
      expect(container.querySelector('.ch-side')).toBeNull();
      expect(container.querySelector('.mode-context')?.getAttribute('aria-label')).toBe(label);
    }
  });
});
