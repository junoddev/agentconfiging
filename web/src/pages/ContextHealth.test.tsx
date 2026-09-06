// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client.js';
import type {
  ContextCost,
  ContextHealth as ContextHealthData,
  GlobalReport,
  InstanceSummary,
  Report,
  StorageReport,
} from '../api/types.js';
import { ToastProvider } from '../components/core/index.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';
import { ContextHealth } from './ContextHealth.js';

type TestClientOverrides = Partial<
  Pick<
    ApiClient,
    | 'getContextCost'
    | 'getContextHealth'
    | 'getGlobalReport'
    | 'getInstances'
    | 'getReport'
    | 'getStorage'
  >
>;

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

const globalReport: GlobalReport = {
  version: '1',
  generatedAt: 'now',
  scope: 'global',
  localOnly: true,
  entries: [],
};

const health: ContextHealthData = {
  totalBytes: 2048,
  fileCount: 2,
  budgetBytes: 8192,
  budgetRatio: 0.25,
  status: 'ok',
  byCategory: [
    { category: 'instructions', bytes: 1536, files: 1 },
    { category: 'settings', bytes: 512, files: 1 },
  ],
  largest: [{ path: 'CLAUDE.md', size: 1536, category: 'instructions' }],
  suggestions: [],
};

const storage: StorageReport = {
  instance: 'default',
  homes: [],
};

function cost(over: Partial<ContextCost> = {}): ContextCost {
  return {
    budgetTokens: 100000,
    agents: [
      {
        kind: 'claude-code',
        totalTokens: 1200,
        budgetTokens: 100000,
        budgetRatio: 0.012,
        status: 'ok',
      },
      {
        kind: 'codex',
        totalTokens: 5200,
        budgetTokens: 100000,
        budgetRatio: 0.052,
        status: 'warn',
      },
    ],
    ...over,
  };
}

function deps(client: TestClientOverrides): AppStateDeps {
  return {
    client: {
      getInstances: async () => [instance],
      getGlobalReport: async () => globalReport,
      getReport: async () => report,
      getContextHealth: async () => health,
      getContextCost: async () => cost(),
      getStorage: async () => storage,
      ...client,
    } as unknown as ApiClient,
    makeWs: () => ({ start: () => {}, close: () => {} }),
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('ContextHealth initial-context costs', () => {
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
    vi.restoreAllMocks();
  });

  it('keeps aggregate health and storage visible while initial-context costs are pending', async () => {
    const getContextCost = vi.fn(() => new Promise<ContextCost>(() => {}));
    const getContextHealth = vi.fn(async () => health);
    const getStorage = vi.fn(async () => storage);

    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider
            deps={deps({
              getContextCost,
              getContextHealth,
              getStorage,
            })}
          >
            <ContextHealth />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('measuring initial context');
    expect(container.textContent).toContain('Context config');
    expect(container.textContent).toContain('2.0 KB');
    expect(container.textContent).toContain('no agent config directories found');
    expect(getContextCost).toHaveBeenCalled();
    expect(getContextHealth).toHaveBeenCalled();
    expect(getStorage).toHaveBeenCalled();
  });

  it('renders one initial-context tile per returned agent with tokens, budget, and status', async () => {
    const getContextCost = vi.fn(async () => cost());
    const getContextHealth = vi.fn(async () => health);

    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps({ getContextCost, getContextHealth })}>
            <ContextHealth />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('Initial context');
    expect(container.textContent).toContain('1,200');
    expect(container.textContent).toContain('claude-code initial tokens');
    expect(container.textContent).toContain('100,000 budget · 1% · within budget');
    expect(container.textContent).toContain('5,200');
    expect(container.textContent).toContain('codex initial tokens');
    expect(container.textContent).toContain('100,000 budget · 5% · nearing budget');

    expect(container.textContent).toContain('Context config');
    expect(container.textContent).toContain('2.0 KB');
    expect(container.textContent).toContain('25%');
    expect(container.textContent).toContain('2');
    expect(getContextCost).toHaveBeenCalled();
    expect(getContextHealth).toHaveBeenCalled();
  });

  it('renders the zero-agent empty state', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps({ getContextCost: async () => cost({ agents: [] }) })}>
            <ContextHealth />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('No detected agents');
    expect(container.textContent).toContain(
      'no initial context token costs were reported for this instance',
    );
  });

  it('keeps aggregate context-health metrics visible when context-cost errors', async () => {
    const getContextCost = vi.fn(async () => {
      throw new ApiError(500, 'server', 'boom');
    });
    const getContextHealth = vi.fn(async () => health);

    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider
            deps={deps({
              getContextCost,
              getContextHealth,
            })}
          >
            <ContextHealth />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('Initial context unavailable');
    expect(container.textContent).toContain('could not load initial context');
    expect(container.textContent).toContain('Context config');
    expect(container.textContent).toContain('2.0 KB');
    expect(getContextCost).toHaveBeenCalled();
    expect(getContextHealth).toHaveBeenCalled();
  });
});
