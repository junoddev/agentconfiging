import { describe, expect, it } from 'vitest';
import type { InstanceSummary, Report } from '../api/types.js';
import { appReducer, currentInstance, initialAppState } from './appState.js';

function inst(over: Partial<InstanceSummary> = {}): InstanceSummary {
  return {
    id: 'a',
    name: 'proj',
    root: '/p',
    markers: [],
    loaded: false,
    isDefault: false,
    ...over,
  };
}

const REPORT: Report = {
  version: '1',
  generatedAt: 'now',
  root: '/p',
  scope: 'project',
  localOnly: false,
  agents: [],
  findings: [],
  stats: { fileCount: 0, totalBytes: 0 },
};

describe('appReducer', () => {
  it('starts empty and offline', () => {
    const s = initialAppState();
    expect(s).toEqual({ instances: [], wsState: 'offline', loading: false });
  });

  it('report:loading flips loading on', () => {
    expect(appReducer(initialAppState(), { type: 'report:loading' }).loading).toBe(true);
  });

  it('instances:loaded stores the list', () => {
    const s = appReducer(initialAppState(), {
      type: 'instances:loaded',
      instances: [inst()],
    });
    expect(s.instances).toHaveLength(1);
  });

  it('report:loaded stores the report, ends loading, clears error', () => {
    const withErr = appReducer(initialAppState(), {
      type: 'error',
      error: { kind: 'network', message: 'x' },
    });
    const s = appReducer({ ...withErr, loading: true }, { type: 'report:loaded', report: REPORT });
    expect(s.report).toBe(REPORT);
    expect(s.loading).toBe(false);
    expect(s.error).toBeUndefined();
  });

  it('instance:select switches id, drops stale report, sets loading', () => {
    const base = appReducer(initialAppState(), { type: 'report:loaded', report: REPORT });
    const s = appReducer(base, { type: 'instance:select', id: 'b' });
    expect(s.currentInstanceId).toBe('b');
    expect(s.report).toBeUndefined();
    expect(s.loading).toBe(true);
  });

  it('instance:select is a no-op when the id is unchanged', () => {
    const base = appReducer(initialAppState(), { type: 'instance:select', id: 'b' });
    const same = appReducer(base, { type: 'instance:select', id: 'b' });
    expect(same).toBe(base);
  });

  it('ws:state updates and de-dupes', () => {
    const connected = appReducer(initialAppState(), { type: 'ws:state', state: 'connected' });
    expect(connected.wsState).toBe('connected');
    expect(appReducer(connected, { type: 'ws:state', state: 'connected' })).toBe(connected);
  });

  it('error sets the error and stops loading', () => {
    const s = appReducer(
      { ...initialAppState(), loading: true },
      { type: 'error', error: { kind: 'unauthorized', message: 'x' } },
    );
    expect(s.error?.kind).toBe('unauthorized');
    expect(s.loading).toBe(false);
  });

  it('error:clear removes the error', () => {
    const s = appReducer(
      { ...initialAppState(), error: { kind: 'unknown', message: 'x' } },
      { type: 'error:clear' },
    );
    expect(s.error).toBeUndefined();
  });
});

describe('currentInstance', () => {
  it('resolves the selected id', () => {
    const state = {
      ...initialAppState(),
      currentInstanceId: 'b',
      instances: [inst({ id: 'a', isDefault: true }), inst({ id: 'b' })],
    };
    expect(currentInstance(state)?.id).toBe('b');
  });

  it('falls back to the default instance when none selected', () => {
    const state = {
      ...initialAppState(),
      instances: [inst({ id: 'a' }), inst({ id: 'b', isDefault: true })],
    };
    expect(currentInstance(state)?.id).toBe('b');
  });

  it('returns undefined when there are no instances', () => {
    expect(currentInstance(initialAppState())).toBeUndefined();
  });
});
