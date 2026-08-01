// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type {
  DetectedAgent,
  GlobalReport,
  InstanceSummary,
  Report,
  ReportFinding,
} from '../api/types.js';
import { ToastProvider } from '../components/core/index.js';
import { AppStateProvider, type AppStateDeps, useAppState } from '../state/index.js';
import { Findings } from './Findings.js';

const instance: InstanceSummary = {
  id: 'default',
  name: 'project',
  root: '/project',
  markers: [],
  loaded: true,
  isDefault: true,
};

function agent(kind: string): DetectedAgent {
  return { kind, confidence: 'high', files: [`${kind}.md`], extras: {} };
}

function finding(over: Pick<ReportFinding, 'id' | 'agent' | 'severity' | 'title'>): ReportFinding {
  return { detail: '', ...over };
}

const report: Report = {
  version: '1',
  generatedAt: 'now',
  root: '/project',
  scope: 'project',
  localOnly: false,
  agents: [agent('claude-code'), agent('codex')],
  findings: [
    finding({
      id: 'claude-project',
      agent: 'claude-code',
      severity: 'error',
      title: 'Claude project finding',
    }),
    finding({
      id: 'codex-project',
      agent: 'codex',
      severity: 'warning',
      title: 'Codex project finding',
    }),
  ],
  stats: { fileCount: 2, totalBytes: 10 },
};

const globalReport: GlobalReport = {
  version: '1',
  generatedAt: 'now',
  scope: 'global',
  localOnly: true,
  entries: [
    {
      root: '/home/u/.claude',
      dir: '.claude',
      agents: [agent('claude-code')],
      findings: [
        finding({
          id: 'claude-global',
          agent: 'claude-code',
          severity: 'info',
          title: 'Claude global finding',
        }),
      ],
      stats: { fileCount: 1, totalBytes: 5 },
    },
    {
      root: '/home/u/.codex',
      dir: '.codex',
      agents: [agent('codex')],
      findings: [
        finding({
          id: 'codex-global',
          agent: 'codex',
          severity: 'error',
          title: 'Codex global finding',
        }),
      ],
      stats: { fileCount: 1, totalBytes: 5 },
    },
  ],
};

const deps: AppStateDeps = {
  client: {
    getInstances: async () => [instance],
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

function Harness() {
  const { selectAgent } = useAppState();
  return (
    <>
      <button type="button" onClick={() => selectAgent('codex')}>
        Pick Codex
      </button>
      <Findings />
    </>
  );
}

describe('Findings agent scoping', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
  });

  it('renders and re-counts only findings for the active top-bar agent', async () => {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps}>
            <Harness />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();

    expect(container.textContent).toContain('Claude project finding');
    expect(container.textContent).toContain('Claude global finding');
    expect(container.textContent).not.toContain('Codex project finding');
    expect(container.textContent).not.toContain('Codex global finding');
    expect(container.textContent).toContain('1 error');
    expect(container.textContent).toContain('0 warnings');
    expect(container.textContent).toContain('0 info');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(container.textContent).toContain('Codex project finding');
    expect(container.textContent).toContain('Codex global finding');
    expect(container.textContent).not.toContain('Claude project finding');
    expect(container.textContent).not.toContain('Claude global finding');
    expect(container.textContent).toContain('0 errors');
    expect(container.textContent).toContain('1 warning');
    expect(container.textContent).toContain('0 info');
  });
});
