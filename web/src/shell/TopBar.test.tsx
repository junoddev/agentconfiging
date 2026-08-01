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
  agents: [],
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

  it('offers Add new and navigates to the Instances tab', async () => {
    await act(async () => {
      root.render(
        <AppStateProvider deps={deps}>
          <TopBar theme="dark" onToggleTheme={() => {}} onAbout={() => {}} onToggleNav={() => {}} />
        </AppStateProvider>,
      );
      await Promise.resolve();
    });

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
});
