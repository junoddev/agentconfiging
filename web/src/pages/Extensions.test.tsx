// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { ExtensionInventoryResponse, InstanceSummary, Report } from '../api/types.js';
import { ToastProvider } from '../components/core/index.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';
import { Extensions } from './Extensions.js';

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

function deps(inventory: ExtensionInventoryResponse): AppStateDeps {
  return {
    client: {
      getInstances: async () => [instance],
      getGlobalReport: async () => ({
        version: '1',
        generatedAt: 'now',
        scope: 'global',
        localOnly: true,
        entries: [],
      }),
      getReport: async () => report,
      getExtensions: async () => inventory,
    } as unknown as ApiClient,
    makeWs: () => ({ start: () => {}, close: () => {} }),
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Extensions (render smoke)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders provider states and hostile inventory values as text', async () => {
    const inventory: ExtensionInventoryResponse = {
      providers: [
        {
          id: 'claude',
          displayName: 'Claude <img src=x>',
          kind: 'native',
          state: 'unavailable',
          scopes: ['user'],
          capabilities: {
            list: true,
            detail: false,
            install: false,
            remove: false,
            update: false,
            enable: false,
            disable: false,
          },
          reason: 'CLI unavailable <script>alert(1)</script>',
        },
      ],
      extensions: [
        {
          providerId: 'claude',
          id: 'plugin<script>',
          name: 'Plugin <b>untrusted</b>',
          version: 'v1',
          scope: 'user',
          source: 'https://example.test/?q=<x>',
          enabled: true,
        },
      ],
    };

    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps(inventory)}>
            <Extensions />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.querySelector('h1')?.textContent).toBe('Extensions');
    expect(container.textContent).toContain('Claude <img src=x>');
    expect(container.textContent).toContain('Plugin <b>untrusted</b>');
    expect(container.textContent).toContain('CLI unavailable <script>alert(1)</script>');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the honest empty/unavailable state', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps({ providers: [], extensions: [] })}>
            <Extensions />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();
    expect(container.textContent).toContain('No runtime providers have been configured.');
    expect(container.textContent).toContain('No installed extensions were reported.');
  });
});
