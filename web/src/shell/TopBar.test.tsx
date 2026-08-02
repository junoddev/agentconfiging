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

  it('shows the folder chooser on every application surface', async () => {
    const routes = [
      { name: 'overview' as const },
      { name: 'settings' as const },
      { name: 'catalog' as const },
      { name: 'dashboard' as const },
      { name: 'git' as const },
    ];

    for (const { name } of routes) {
      await renderTopBar({ name });
      const chooser = container.querySelector('.chooser');
      expect(chooser?.getAttribute('aria-label')).toBe('Current folder');
      expect(container.querySelector('.mode-context')).toBeNull();
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>('.ch-side')).map((button) =>
          button.getAttribute('aria-label'),
        ),
      ).toEqual(['Current folder: project']);
    }
  });
});
