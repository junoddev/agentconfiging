// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { GlobalReport, InstanceSummary, Report } from '../api/types.js';
import { ToastProvider } from '../components/core/index.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';

const instances: InstanceSummary[] = [
  {
    id: 'default',
    name: 'Default',
    root: '/repo/default',
    markers: [],
    loaded: true,
    isDefault: true,
  },
  {
    id: 'other',
    name: 'Other',
    root: '/repo/other',
    markers: [],
    loaded: true,
    isDefault: false,
  },
];

const report: Report = {
  version: '1',
  generatedAt: 'now',
  root: '/repo/default',
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

const deps: AppStateDeps = {
  client: {
    getInstances: async () => instances,
    getGlobalReport: async () => globalReport,
    getReport: async () => report,
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

function diffWithMarker(marker: string): string {
  return [
    'diff --git a/shared.txt b/shared.txt',
    '--- a/shared.txt',
    '+++ b/shared.txt',
    '@@ -1 +1 @@',
    '-before',
    `+${marker}`,
    '',
  ].join('\n');
}

describe('Operate target selection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;
  let sockets: TestWebSocket[];

  class TestWebSocket {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;

    constructor(
      readonly url: string,
      readonly protocols: string[],
    ) {
      sockets.push(this);
    }

    close() {}
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.location.hash = '';
    window.sessionStorage.clear();
    window.sessionStorage.setItem('agentconfig:session-token', 'test-token');
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    sockets = [];
    vi.stubGlobal('WebSocket', TestWebSocket);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/pipelines\/[^/]+\/runs$/.test(url)) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      }
      if (/\/api\/pipelines\/[^/]+\/schedule$/.test(url)) {
        return new Response(JSON.stringify({ schedule: null, nextRun: null }), { status: 200 });
      }
      if (url.endsWith('/api/pipelines')) {
        return new Response(JSON.stringify({ pipelines: [] }), { status: 200 });
      }
      if (url.startsWith('/api/git/status?instance=')) {
        return new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            branch: 'main',
            detached: false,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [],
            untracked: [],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith('/api/git/log?instance=')) {
        return new Response(JSON.stringify({ gitAvailable: true, isRepo: true, commits: [] }), {
          status: 200,
        });
      }
      if (url.startsWith('/api/git/branches?instance=')) {
        return new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            branches: [{ name: 'main', current: true }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it('Git blocks and does not fetch git state without an explicit route target', async () => {
    const { Git } = await import('./Git.js');
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Git />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('No target selected');
    expect(container.textContent).toContain(
      'Choose a repository target before running git actions.',
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      const select = container.querySelector<HTMLSelectElement>(
        'select[aria-label="git target repository"]',
      );
      expect(select).toBeTruthy();
      select!.value = 'other';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(window.location.hash).toBe('#/git?instance=other');
  });

  it('Git refreshes from WS pushes for its explicit target only', async () => {
    const { Git } = await import('./Git.js');
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Git target={{ instanceId: 'other' }} />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('Other');
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/git/status?instance=other'),
      ),
    ).toHaveLength(1);

    await act(async () => {
      sockets[0]?.onmessage?.({
        data: JSON.stringify({ type: 'report', instance: 'default', changed: ['AGENTS.md'] }),
      });
    });
    await flush();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/git/status?instance=other'),
      ),
    ).toHaveLength(1);

    await act(async () => {
      sockets[0]?.onmessage?.({
        data: JSON.stringify({ type: 'report', instance: 'other', changed: ['AGENTS.md'] }),
      });
    });
    await flush();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith('/api/git/status?instance=other'),
      ),
    ).toHaveLength(2);
  });

  it("Git ignores an older target's delayed diff after a new target diff is open", async () => {
    let resolveDefaultDiff!: (response: Response) => void;
    const defaultDiff = new Promise<Response>((resolve) => {
      resolveDefaultDiff = resolve;
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const instance = url.searchParams.get('instance') ?? 'default';
      if (url.pathname === '/api/git/status') {
        return new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            branch: 'main',
            detached: false,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [{ path: 'shared.txt', status: 'M' }],
            untracked: [],
          }),
          { status: 200 },
        );
      }
      if (url.pathname === '/api/git/log') {
        return new Response(JSON.stringify({ gitAvailable: true, isRepo: true, commits: [] }), {
          status: 200,
        });
      }
      if (url.pathname === '/api/git/branches') {
        return new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            branches: [{ name: 'main', current: true }],
          }),
          { status: 200 },
        );
      }
      if (url.pathname === '/api/git/diff') {
        if (instance === 'default') return defaultDiff;
        return new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            diff: diffWithMarker('other-target-diff'),
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 });
    });

    const { Git } = await import('./Git.js');
    const diffButton = () => {
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) => candidate.textContent === 'Diff',
      );
      expect(button).toBeTruthy();
      return button!;
    };
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Git target={{ instanceId: 'default' }} />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    await act(async () => {
      diffButton().click();
    });

    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Git target={{ instanceId: 'other' }} />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    await act(async () => {
      diffButton().click();
    });
    await flush();

    expect(container.textContent).toContain('other-target-diff');

    await act(async () => {
      resolveDefaultDiff(
        new Response(
          JSON.stringify({
            gitAvailable: true,
            isRepo: true,
            diff: diffWithMarker('default-target-diff'),
          }),
          { status: 200 },
        ),
      );
    });
    await flush();

    expect(container.textContent).toContain('other-target-diff');
    expect(container.textContent).not.toContain('default-target-diff');
  });

  it('Terminal blocks new sessions without changing the Configure-selected instance', async () => {
    const { Terminal } = await import('./Terminal.js');
    await act(async () => {
      root.render(
        <AppStateProvider deps={deps}>
          <Terminal active theme="dark" />
        </AppStateProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('No target selected');
    expect(container.textContent).toContain(
      'Choose a repository target before opening new terminal sessions.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Pipelines displays the missing target and disables operational actions', async () => {
    const { Pipelines } = await import('./Pipelines.js');
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Pipelines target={{ instanceId: 'gone' }} />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('missing instance gone');
    expect(container.textContent).toContain(
      'The selected Pipeline target no longer exists. Choose a project before running or scheduling.',
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Run',
      )?.disabled,
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Save schedule',
      )?.disabled,
    ).toBe(true);
  });

  it('Pipelines surfaces a persisted schedule target mismatch and blocks saving it', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/pipelines\/[^/]+\/runs$/.test(url)) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      }
      if (/\/api\/pipelines\/[^/]+\/schedule$/.test(url)) {
        return new Response(
          JSON.stringify({
            schedule: {
              pipelineId: 'pipe-1',
              cron: '@daily',
              enabled: true,
              instanceRoot: '/repo/default',
            },
            nextRun: null,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/pipelines')) {
        return new Response(JSON.stringify({ pipelines: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 });
    });

    const { Pipelines } = await import('./Pipelines.js');
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Pipelines target={{ instanceId: 'other' }} />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('bound /repo/default · page /repo/other');
    expect(container.textContent).toContain(
      'The saved schedule target differs from the selected page target.',
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === 'Save schedule',
      )?.disabled,
    ).toBe(true);
  });
});
