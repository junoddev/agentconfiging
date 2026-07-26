import { describe, expect, it } from 'vitest';
import type { SyncTarget } from '../../api/index.js';
import {
  defaultSelection,
  isActionable,
  planSummary,
  selectedRuntimeIds,
  statusLabel,
  statusTone,
} from './logic.js';

function target(over: Partial<SyncTarget>): SyncTarget {
  return {
    runtimeIds: ['codex'],
    displayNames: ['OpenAI Codex'],
    path: 'AGENTS.md',
    status: 'new',
    diff: '',
    lossy: false,
    ...over,
  };
}

describe('isActionable / defaultSelection', () => {
  it('actionable only for new + changed', () => {
    expect(isActionable(target({ status: 'new' }))).toBe(true);
    expect(isActionable(target({ status: 'changed' }))).toBe(true);
    expect(isActionable(target({ status: 'in-sync' }))).toBe(false);
    expect(isActionable(target({ status: 'unwritable' }))).toBe(false);
  });

  it('pre-selects every actionable target by path', () => {
    const targets = [
      target({ path: 'AGENTS.md', status: 'new' }),
      target({ path: 'GEMINI.md', status: 'changed' }),
      target({ path: '.rules', status: 'in-sync' }),
      target({ path: 'best_practices.md', status: 'unwritable' }),
    ];
    expect(defaultSelection(targets)).toEqual(new Set(['AGENTS.md', 'GEMINI.md']));
  });
});

describe('statusLabel / statusTone', () => {
  it('labels each status', () => {
    expect(statusLabel('new')).toBe('missing');
    expect(statusLabel('changed')).toBe('drifted');
    expect(statusLabel('in-sync')).toBe('in sync');
    expect(statusLabel('unwritable')).toBe('unwritable');
  });
  it('tones drift as warn, missing as signal', () => {
    expect(statusTone('changed')).toBe('warn');
    expect(statusTone('new')).toBe('signal');
    expect(statusTone('in-sync')).toBe('dim');
  });
});

describe('selectedRuntimeIds', () => {
  it('unions runtime ids across selected rows, sorted + deduped', () => {
    const targets = [
      target({ path: 'AGENTS.md', runtimeIds: ['codex', 'opencode'] }),
      target({ path: '.cursor/rules/project.mdc', runtimeIds: ['cursor'] }),
      target({ path: '.rules', runtimeIds: ['zed'] }),
    ];
    const selected = new Set(['AGENTS.md', '.cursor/rules/project.mdc']);
    expect(selectedRuntimeIds(targets, selected)).toEqual(['codex', 'cursor', 'opencode']);
  });
});

describe('planSummary', () => {
  it('counts each status bucket', () => {
    const targets = [
      target({ status: 'new' }),
      target({ status: 'changed' }),
      target({ status: 'changed' }),
      target({ status: 'in-sync' }),
      target({ status: 'unwritable' }),
    ];
    expect(planSummary(targets)).toEqual({ drifted: 2, missing: 1, inSync: 1, unwritable: 1 });
  });
});
