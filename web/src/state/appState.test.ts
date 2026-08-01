import { describe, expect, it } from 'vitest';
import type { DetectedAgent, GlobalReport, InstanceSummary, Report } from '../api/types.js';
import { activeAgent, appReducer, currentInstance, initialAppState } from './appState.js';

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

const GLOBAL_REPORT: GlobalReport = {
  version: '1',
  generatedAt: 'now',
  scope: 'global',
  localOnly: true,
  entries: [
    {
      root: '/home/u/.claude',
      dir: '.claude',
      agents: [],
      findings: [],
      stats: { fileCount: 0, totalBytes: 0 },
    },
  ],
};

describe('appReducer', () => {
  it('starts empty and offline', () => {
    const s = initialAppState();
    expect(s).toEqual({ instances: [], wsState: 'offline', loading: false, globalLoading: false });
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

  it('report:loaded applies when its instanceId matches the current instance', () => {
    const onB = appReducer(initialAppState(), { type: 'instance:select', id: 'b' });
    const s = appReducer(onB, { type: 'report:loaded', report: REPORT, instanceId: 'b' });
    expect(s.report).toBe(REPORT);
    expect(s.loading).toBe(false);
  });

  it('report:loaded is DROPPED when its instanceId no longer matches (out-of-order guard)', () => {
    // Simulates a fast A→B switch: the current instance is now B, but a slow
    // getReport(A) resolves and dispatches report:loaded for A. It must not
    // overwrite B's view (regression: finding #2).
    const onB = appReducer(initialAppState(), { type: 'instance:select', id: 'b' });
    const s = appReducer(onB, { type: 'report:loaded', report: REPORT, instanceId: 'a' });
    expect(s).toBe(onB); // unchanged — the stale A report is ignored
    expect(s.report).toBeUndefined();
    expect(s.loading).toBe(true);
  });

  it('report:loaded with no instanceId is unscoped and always applies', () => {
    const onB = appReducer(initialAppState(), { type: 'instance:select', id: 'b' });
    const s = appReducer(onB, { type: 'report:loaded', report: REPORT });
    expect(s.report).toBe(REPORT);
  });

  it('instance:select switches id, drops stale report, sets loading', () => {
    const base = appReducer(initialAppState(), { type: 'report:loaded', report: REPORT });
    const s = appReducer(base, { type: 'instance:select', id: 'b' });
    expect(s.currentInstanceId).toBe('b');
    expect(s.report).toBeUndefined();
    expect(s.loading).toBe(true);
  });

  it('boot sequence seeds currentInstanceId so the default instance resolves (finding #1)', () => {
    // The provider boot now dispatches instance:select for the resolved default
    // (instead of only poking a ref), so currentInstanceId lands in state and the
    // WS push guard — which compares the live instance against the ref kept in
    // sync with currentInstanceId — matches for the boot instance.
    const def = inst({ id: 'def', isDefault: true });
    let s = appReducer(initialAppState(), { type: 'instances:loaded', instances: [def] });
    s = appReducer(s, { type: 'instance:select', id: 'def' });
    expect(s.currentInstanceId).toBe('def');
    expect(currentInstance(s)?.id).toBe('def');
    // The default report then applies because its instanceId matches.
    s = appReducer(s, { type: 'report:loaded', report: REPORT, instanceId: 'def' });
    expect(s.report).toBe(REPORT);
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

  it('global:loading flips globalLoading on (project loading untouched)', () => {
    const s = appReducer(initialAppState(), { type: 'global:loading' });
    expect(s.globalLoading).toBe(true);
    expect(s.loading).toBe(false);
  });

  it('global:loaded stores the report, ends globalLoading, clears globalError', () => {
    const withErr = appReducer(initialAppState(), {
      type: 'global:error',
      error: { kind: 'network', message: 'x' },
    });
    const s = appReducer(
      { ...withErr, globalLoading: true },
      { type: 'global:loaded', report: GLOBAL_REPORT },
    );
    expect(s.globalReport).toBe(GLOBAL_REPORT);
    expect(s.globalLoading).toBe(false);
    expect(s.globalError).toBeUndefined();
  });

  it('global:error is confined to the global slice — project error untouched', () => {
    const s = appReducer(
      { ...initialAppState(), globalLoading: true },
      { type: 'global:error', error: { kind: 'unknown', message: 'boom' } },
    );
    expect(s.globalError?.kind).toBe('unknown');
    expect(s.globalLoading).toBe(false);
    expect(s.error).toBeUndefined();
  });

  it('project error leaves the global slice untouched (and vice versa on clear)', () => {
    const withGlobal = appReducer(initialAppState(), {
      type: 'global:loaded',
      report: GLOBAL_REPORT,
    });
    const s = appReducer(withGlobal, {
      type: 'error',
      error: { kind: 'unauthorized', message: 'x' },
    });
    expect(s.globalReport).toBe(GLOBAL_REPORT);
    expect(s.globalError).toBeUndefined();
    // report:loaded clears the project error but never the global slice.
    const withGlobalErr = appReducer(s, {
      type: 'global:error',
      error: { kind: 'network', message: 'y' },
    });
    const recovered = appReducer(withGlobalErr, { type: 'report:loaded', report: REPORT });
    expect(recovered.error).toBeUndefined();
    expect(recovered.globalError?.kind).toBe('network');
  });
});

function agent(kind: string): DetectedAgent {
  return { kind, confidence: 'high', files: [], extras: {} };
}

describe('agent:select / activeAgent', () => {
  const twoAgents: Report = { ...REPORT, agents: [agent('claude-code'), agent('cursor')] };

  it('initialAppState seeds the stored preference when given', () => {
    expect(initialAppState('cursor').activeAgentKind).toBe('cursor');
    expect(initialAppState().activeAgentKind).toBeUndefined();
  });

  it('agent:select stores the kind and de-dupes', () => {
    const s = appReducer(initialAppState(), { type: 'agent:select', kind: 'cursor' });
    expect(s.activeAgentKind).toBe('cursor');
    expect(appReducer(s, { type: 'agent:select', kind: 'cursor' })).toBe(s);
  });

  it('activeAgent resolves the preferred kind against the report', () => {
    const s = appReducer(
      { ...initialAppState('cursor') },
      { type: 'report:loaded', report: twoAgents },
    );
    expect(activeAgent(s)?.kind).toBe('cursor');
  });

  it('activeAgent falls back to the first detection when the preference is absent', () => {
    const s = appReducer(
      { ...initialAppState('codex') },
      { type: 'report:loaded', report: twoAgents },
    );
    expect(activeAgent(s)?.kind).toBe('claude-code');
  });

  it('activeAgent is undefined with no report or no detections', () => {
    expect(activeAgent(initialAppState('cursor'))).toBeUndefined();
    const empty = appReducer(initialAppState(), { type: 'report:loaded', report: REPORT });
    expect(activeAgent(empty)).toBeUndefined();
  });

  it('the preference survives an instance switch (only the report drops)', () => {
    const picked = appReducer(initialAppState(), { type: 'agent:select', kind: 'cursor' });
    const switched = appReducer(picked, { type: 'instance:select', id: 'b' });
    expect(switched.activeAgentKind).toBe('cursor');
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
