// @vitest-environment jsdom
/**
 * Provider render-tests for AppStateContext — the end-to-end regressions for
 * findings #1 (live WS refresh dead for the boot instance) and #2 (out-of-order
 * report responses render stale reports). These drive the REAL provider through
 * its injectable `deps` (a fake ApiClient + a captured WS handler), which is the
 * only way to exercise the boot effect + WS wiring that the reducer-level tests
 * in appState.test.ts cannot reach.
 *
 * ENVIRONMENT: the vitest `dom` project (see vitest.config.ts) routes every
 * `*.test.tsx` to `jsdom` with the React JSX transform, so this file mounts the
 * REAL provider through `react-dom/client`. The `hasDom` guard below is now a
 * belt-and-suspenders no-op (a DOM is always present here); it stays only so the
 * file can never hard-fail if it is ever collected without a DOM.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client.js';
import type { InstanceSummary, Report } from '../api/types.js';
import type { WsState } from '../ws/client.js';
import { AppStateProvider, useAppState, type AppStateDeps, type AppStateValue } from './index.js';

const hasDom = typeof document !== 'undefined';
const suite = hasDom ? describe : describe.skip;

function inst(over: Partial<InstanceSummary> = {}): InstanceSummary {
  return {
    id: 'a',
    name: 'proj',
    root: '/p',
    markers: [],
    loaded: true,
    isDefault: false,
    ...over,
  };
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

/** A deferred promise whose resolution the test controls, to force ordering. */
function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Latest context value, captured by a probe child on every render. */
let latest: AppStateValue | undefined;
function Probe() {
  latest = useAppState();
  return null;
}

/** Flush pending microtasks/effects inside act so async boot work settles. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

suite('AppStateProvider (render)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    latest = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(deps: AppStateDeps) {
    await act(async () => {
      root.render(
        <AppStateProvider deps={deps}>
          <Probe />
        </AppStateProvider>,
      );
    });
    await flush();
  }

  it('a WS push for the DEFAULT instance triggers a refetch (finding #1)', async () => {
    const def = inst({ id: 'def', isDefault: true });
    const getReport = vi.fn(async () => report());
    let ws: { onMessage: (i: string) => void; onState: (s: WsState) => void } | undefined;
    const deps: AppStateDeps = {
      client: {
        getInstances: async () => [def],
        getGlobalReport: async () => {
          throw new Error('no global watcher');
        },
        getReport,
      } as unknown as ApiClient,
      makeWs: (handlers) => {
        ws = handlers;
        return { start: () => {}, close: () => {} };
      },
    };

    await render(deps);
    // Boot loaded the default instance's report exactly once.
    expect(getReport).toHaveBeenCalledTimes(1);
    expect(latest?.currentInstance?.id).toBe('def');

    // A file-change push for the boot instance must trigger a refetch — the case
    // that was previously dropped because currentIdRef stayed undefined.
    await act(async () => {
      ws?.onMessage('def');
      await Promise.resolve();
    });
    await flush();
    expect(getReport).toHaveBeenCalledTimes(2);
  });

  it('an out-of-order report response does NOT overwrite the current instance (finding #2)', async () => {
    const a = inst({ id: 'a', isDefault: true });
    const b = inst({ id: 'b' });
    const reportA = report({ root: '/a' });
    const reportB = report({ root: '/b' });
    const dA = defer<Report>();
    const dB = defer<Report>();
    const getReport = vi.fn((id?: string) => (id === 'b' ? dB.promise : dA.promise));
    const deps: AppStateDeps = {
      client: {
        getInstances: async () => [a, b],
        getGlobalReport: async () => {
          throw new Error('no global watcher');
        },
        getReport,
      } as unknown as ApiClient,
      makeWs: () => ({ start: () => {}, close: () => {} }),
    };

    await render(deps);
    // Boot fired getReport('a') (still pending). Switch to B while A is in flight.
    await act(async () => {
      latest?.selectInstance('b');
      await Promise.resolve();
    });
    await flush();

    // B resolves FIRST and is shown.
    await act(async () => {
      dB.resolve(reportB);
      await Promise.resolve();
    });
    await flush();
    expect(latest?.report).toBe(reportB);

    // A resolves LATE — it must be ignored, not clobber B.
    await act(async () => {
      dA.resolve(reportA);
      await Promise.resolve();
    });
    await flush();
    expect(latest?.report).toBe(reportB);
  });
});
