/**
 * Watcher unit tests (agentconfig-gxo.4): the pure structural reportDiff, the
 * 150ms debounce/coalesce (fake timers + fake chokidar), the live-session
 * pulse routing, start-on-load / stop-on-unload through the registry seam,
 * symlink-not-followed config, and watcher error resilience (logged not thrown).
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InstanceWatcher,
  WatcherSupervisor,
  reportDiff,
  type WatchFn,
  type WatcherLike,
  type WatcherMessage,
} from './watcher.js';
import { InstanceRegistry } from './registry.js';
import type { RegistryInstance } from './registry.js';
import type { ReportStore, ServedReport } from './store.js';
import type { DetectedAgent } from '../core/index.js';

function makeReport(
  findings: { id: string }[],
  agents: Partial<DetectedAgent>[] = [],
): ServedReport {
  return {
    version: '1.0.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    root: '/proj',
    scope: 'project',
    localOnly: false,
    agents: agents.map((a) => ({
      kind: a.kind ?? 'claude-code',
      confidence: a.confidence ?? 'high',
      files: a.files ?? [],
      extras: a.extras ?? {},
    })),
    findings: findings.map((f) => ({
      id: f.id,
      severity: 'warning',
      agent: 'claude-code',
      title: 't',
      detail: 'd',
    })),
    stats: { fileCount: 0, totalBytes: 0, skipped: 0 },
  };
}

describe('reportDiff (pure structural diff)', () => {
  it('reports a finding that appeared', () => {
    expect(reportDiff(makeReport([]), makeReport([{ id: 'a' }])).changed).toEqual([
      'finding-added:a',
    ]);
  });

  it('reports a finding that resolved', () => {
    expect(reportDiff(makeReport([{ id: 'a' }]), makeReport([])).changed).toEqual([
      'finding-resolved:a',
    ]);
  });

  it('reports an agent that was added', () => {
    const next = makeReport([], [{ kind: 'cursor' }]);
    expect(reportDiff(makeReport([]), next).changed).toEqual(['agent-added:cursor']);
  });

  it('reports an agent removed and an agent whose files/confidence changed', () => {
    const prev = makeReport(
      [],
      [
        { kind: 'claude-code', files: ['CLAUDE.md'] },
        { kind: 'gone', files: [] },
      ],
    );
    const next = makeReport([], [{ kind: 'claude-code', files: ['CLAUDE.md', 'AGENTS.md'] }]);
    expect(reportDiff(prev, next).changed).toEqual([
      'agent-changed:claude-code',
      'agent-removed:gone',
    ]);

    const confPrev = makeReport([], [{ kind: 'claude-code', confidence: 'low' }]);
    const confNext = makeReport([], [{ kind: 'claude-code', confidence: 'high' }]);
    expect(reportDiff(confPrev, confNext).changed).toEqual(['agent-changed:claude-code']);
  });

  it('treats an undefined prev as everything-added and sorts deterministically', () => {
    const next = makeReport([{ id: 'b' }, { id: 'a' }], [{ kind: 'cursor' }]);
    expect(reportDiff(undefined, next).changed).toEqual([
      'agent-added:cursor',
      'finding-added:a',
      'finding-added:b',
    ]);
  });

  it('is empty when nothing structural changed', () => {
    const r = makeReport([{ id: 'a' }], [{ kind: 'claude-code', files: ['CLAUDE.md'] }]);
    expect(
      reportDiff(r, makeReport([{ id: 'a' }], [{ kind: 'claude-code', files: ['CLAUDE.md'] }]))
        .changed,
    ).toEqual([]);
  });
});

/** A fake chokidar: captures the 'all' handler + the options it was built with. */
function fakeWatch(): {
  watch: WatchFn;
  fire: (event: string, p: string) => void;
  fireError: (err: unknown) => void;
  options: () => Record<string, unknown> | undefined;
  paths: () => string[] | undefined;
  closeCalls: () => number;
} {
  let handler: ((...args: unknown[]) => void) | undefined;
  let errHandler: ((...args: unknown[]) => void) | undefined;
  let opts: Record<string, unknown> | undefined;
  let watchedPaths: string[] | undefined;
  let closeCount = 0;
  const watch: WatchFn = (paths, options) => {
    watchedPaths = paths;
    opts = options;
    const w: WatcherLike = {
      on(event, cb) {
        if (event === 'all') handler = cb;
        if (event === 'error') errHandler = cb;
        return w;
      },
      close() {
        closeCount += 1;
        return Promise.resolve();
      },
    };
    return w;
  };
  return {
    watch,
    fire: (event, p) => handler?.(event, p),
    fireError: (err) => errHandler?.(err),
    options: () => opts,
    paths: () => watchedPaths,
    closeCalls: () => closeCount,
  };
}

function fakeStore(report: ServedReport): {
  store: ReportStore;
  getCalls: () => number;
  invalidateCalls: () => number;
} {
  let getCalls = 0;
  let invalidateCalls = 0;
  const store = {
    get: () => {
      getCalls += 1;
      return report;
    },
    invalidate: () => {
      invalidateCalls += 1;
    },
  } as unknown as ReportStore;
  return { store, getCalls: () => getCalls, invalidateCalls: () => invalidateCalls };
}

const instanceFor = (root = '/proj'): RegistryInstance => ({
  id: 'inst1',
  root,
  markers: [],
  loaded: true,
});

const HOME = path.join(path.sep, 'home', 'user', '.claude');

describe('InstanceWatcher debounce / coalesce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces N rapid config changes into ONE re-run + one report push', () => {
    const chok = fakeWatch();
    const { store, getCalls, invalidateCalls } = fakeStore(makeReport([{ id: 'a' }]));
    const messages: WatcherMessage[] = [];
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: (m) => messages.push(m),
      watch: chok.watch,
    });
    watcher.start(); // baseline get() → getCalls === 1
    expect(getCalls()).toBe(1);

    for (let i = 0; i < 5; i += 1) chok.fire('change', '/proj/CLAUDE.md');
    vi.advanceTimersByTime(149);
    expect(messages).toHaveLength(0); // still within debounce window
    vi.advanceTimersByTime(1);

    expect(invalidateCalls()).toBe(1); // one re-run
    expect(getCalls()).toBe(2); // baseline + one fresh re-scan
    expect(messages).toEqual([{ type: 'report', instance: 'inst1', changed: [] }]);
  });

  it('routes a growing session JSONL to a live-session pulse (no report re-run)', () => {
    const chok = fakeWatch();
    const { store, invalidateCalls } = fakeStore(makeReport([]));
    const messages: WatcherMessage[] = [];
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: (m) => messages.push(m),
      watch: chok.watch,
    });
    watcher.start();

    const sessionPath = path.join(HOME, 'projects', 'slug', 'abc123.jsonl');
    chok.fire('change', sessionPath);
    vi.advanceTimersByTime(150);

    expect(invalidateCalls()).toBe(0); // session change never re-runs the report
    expect(messages).toEqual([{ type: 'live-session', instance: 'inst1', sessionId: 'abc123' }]);
  });

  it('close() clears pending timers so no push fires after teardown', async () => {
    const chok = fakeWatch();
    const { store } = fakeStore(makeReport([]));
    const messages: WatcherMessage[] = [];
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: (m) => messages.push(m),
      watch: chok.watch,
    });
    watcher.start();
    chok.fire('change', '/proj/CLAUDE.md');
    await watcher.close();
    vi.advanceTimersByTime(500);
    expect(messages).toHaveLength(0);
    expect(chok.closeCalls()).toBe(1);
  });
});

describe('InstanceWatcher config', () => {
  it('never follows symlinks and prunes SKIP_DIRS', () => {
    const chok = fakeWatch();
    const { store } = fakeStore(makeReport([]));
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: () => undefined,
      watch: chok.watch,
    });
    watcher.start();
    const opts = chok.options()!;
    expect(opts.followSymlinks).toBe(false);
    expect(opts.ignoreInitial).toBe(true);
    expect(typeof opts.ignored).toBe('function');
    expect((opts.ignored as (p: string) => boolean)('/proj/node_modules/x')).toBe(true);
    // Watches the project config + this instance's session dir.
    const paths = chok.paths()!;
    expect(paths).toContain('/proj/CLAUDE.md');
    expect(paths).toContain('/proj/.claude');
    expect(paths.some((p) => p.includes(path.join('projects', '-proj')))).toBe(true);
  });
});

describe('InstanceWatcher error resilience', () => {
  it('a chokidar construction failure is logged, not thrown', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store } = fakeStore(makeReport([]));
    const throwingWatch: WatchFn = () => {
      throw new Error('boom');
    };
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: () => undefined,
      watch: throwingWatch,
    });
    expect(() => watcher.start()).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a chokidar 'error' event is logged, not thrown", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const chok = fakeWatch();
    const { store } = fakeStore(makeReport([]));
    const watcher = new InstanceWatcher({
      instance: instanceFor(),
      store,
      home: HOME,
      onMessage: () => undefined,
      watch: chok.watch,
    });
    watcher.start();
    expect(() => chok.fireError(new Error('EACCES'))).not.toThrow();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('chokidar'));
    spy.mockRestore();
  });
});

describe('WatcherSupervisor lifecycle via the registry seam', () => {
  it('starts a watcher on load and stops it (chokidar closed) on unload/remove', () => {
    const chok = fakeWatch();
    const registry = new InstanceRegistry('1.0.0', () => {
      return {
        get: () => makeReport([]),
        invalidate: () => undefined,
      } as unknown as ReportStore;
    });
    const supervisor = new WatcherSupervisor({
      home: HOME,
      onMessage: () => undefined,
      watch: chok.watch,
    });
    registry.setLifecycle(supervisor);

    const inst = registry.seed('/proj', { makeDefault: true });
    expect(supervisor.size).toBe(0); // lazy — no watcher until load

    registry.report(inst); // first access → load → onLoad → watcher.start()
    expect(supervisor.size).toBe(1);

    registry.unload(inst.id); // onUnload → watcher.close()
    expect(supervisor.size).toBe(0);
    expect(chok.closeCalls()).toBe(1);
  });
});
