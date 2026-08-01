// @vitest-environment jsdom
/**
 * Render smoke tests for the Instructions page — the first page-level render
 * coverage (the harness the rest of the pages can copy). Node tests exercise the
 * pure logic (instructions/logic.ts) and the reducer; only a real mount catches
 * the render/effect/wiring class of bug: a page that throws on an empty report,
 * a missing provider, or a mis-read selector.
 *
 * The page consumes `useAppState` + `useGlobalConfig` (AppStateProvider),
 * `useWriteFlow` (which itself only reads AppState), and `useToast`
 * (ToastProvider). We mount it under BOTH providers with a fake, injected
 * ApiClient — no network, no real socket — and assert two representative states:
 * an empty report (the "No instruction files" empty state) and a report that
 * detects a CLAUDE.md (the file surfaces, the empty state does not).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { DetectedAgent, InstanceSummary, Report } from '../api/types.js';
import { ToastProvider } from '../components/core/index.js';
import { AppStateProvider, type AppStateDeps } from '../state/index.js';
import { Instructions } from './Instructions.js';

function inst(over: Partial<InstanceSummary> = {}): InstanceSummary {
  return {
    id: 'def',
    name: 'proj',
    root: '/p',
    markers: [],
    loaded: true,
    isDefault: true,
    ...over,
  };
}

function agent(over: Partial<DetectedAgent> = {}): DetectedAgent {
  return { kind: 'claude-code', confidence: 'high', files: [], extras: {}, ...over };
}

function report(over: Partial<Report> = {}): Report {
  return {
    version: '1',
    generatedAt: 'now',
    root: '/p',
    scope: 'project',
    localOnly: false,
    agents: [],
    findings: [],
    stats: { fileCount: 0, totalBytes: 0 },
    ...over,
  };
}

/** Fake deps: one default instance, no global watcher, a caller-supplied report. */
function deps(rep: Report): AppStateDeps {
  return {
    client: {
      getInstances: async () => [inst()],
      getGlobalReport: async () => {
        throw new Error('no global watcher');
      },
      getReport: async () => rep,
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

describe('Instructions (render smoke)', () => {
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

  async function mount(rep: Report) {
    await act(async () => {
      root.render(
        <ToastProvider>
          <AppStateProvider deps={deps(rep)}>
            <Instructions />
          </AppStateProvider>
        </ToastProvider>,
      );
    });
    await flush();
  }

  it('mounts on an empty report and shows the empty state', async () => {
    await mount(report());
    // The page heading always renders...
    expect(container.querySelector('h1')?.textContent).toBe('Instructions');
    // ...and with no instruction files, the honest empty state is shown.
    expect(container.textContent).toContain('No instruction files');
  });

  it('surfaces a detected instruction file (no empty state)', async () => {
    await mount(report({ agents: [agent({ files: ['CLAUDE.md'] })] }));
    expect(container.querySelector('h1')?.textContent).toBe('Instructions');
    expect(container.textContent).toContain('CLAUDE.md');
    expect(container.textContent).not.toContain('No instruction files');
  });
});
