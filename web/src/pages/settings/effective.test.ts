import { describe, expect, it } from 'vitest';
import { effectiveRows, filterRows, flattenSettings, matchesQuery } from './effective.js';

describe('flattenSettings', () => {
  it('flattens nested objects to dotted keys; arrays and scalars are leaves', () => {
    const flat = flattenSettings({
      model: 'opus',
      permissions: { defaultMode: 'plan', allow: ['Bash(make *)', 'Read'] },
      env: { DEBUG: 'true' },
    });
    expect([...flat.entries()]).toEqual([
      ['model', 'opus'],
      ['permissions.defaultMode', 'plan'],
      ['permissions.allow', '["Bash(make *)","Read"]'],
      ['env.DEBUG', 'true'],
    ]);
  });

  it('renders empty objects, null, numbers, and booleans honestly', () => {
    const flat = flattenSettings({ hooks: {}, a: null, b: 3, c: false });
    expect(flat.get('hooks')).toBe('{}');
    expect(flat.get('a')).toBe('null');
    expect(flat.get('b')).toBe('3');
    expect(flat.get('c')).toBe('false');
  });

  it('does not blow the stack on a pathologically deep object', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 50_000; i++) deep = { n: deep };
    expect(() => flattenSettings({ root: deep })).not.toThrow();
  });
});

describe('effectiveRows', () => {
  it('merges scopes with local > project > global precedence', () => {
    const rows = effectiveRows({
      global: { model: 'sonnet', env: { A: '1' } },
      project: { model: 'opus' },
      local: { env: { A: '2' } },
    });
    const model = rows.find((r) => r.key === 'model');
    expect(model).toMatchObject({ win: 'project', effective: 'opus' });
    expect(model?.values).toEqual({ global: 'sonnet', project: 'opus' });
    const envA = rows.find((r) => r.key === 'env.A');
    expect(envA).toMatchObject({ win: 'local', effective: '2' });
  });

  it('falls back to the global value when no stronger scope sets the key', () => {
    const rows = effectiveRows({ global: { model: 'sonnet' } });
    expect(rows.find((r) => r.key === 'model')).toMatchObject({
      win: 'global',
      effective: 'sonnet',
    });
  });

  it('appends s-default rows for well-known keys no scope sets', () => {
    const rows = effectiveRows({});
    expect(rows.find((r) => r.key === 'model')).toMatchObject({
      win: 'default',
      effective: '(inherit)',
    });
    expect(rows.find((r) => r.key === 'permissions.defaultMode')).toMatchObject({
      win: 'default',
      effective: 'default',
    });
  });

  it('does not add a default row when any scope sets the key', () => {
    const rows = effectiveRows({ local: { model: 'opus' } });
    const models = rows.filter((r) => r.key === 'model');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ win: 'local', effective: 'opus' });
  });

  it('sorts rows by key', () => {
    const rows = effectiveRows({ project: { z: '1', a: '2' } });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('matchesQuery / filterRows', () => {
  const rows = effectiveRows({
    global: { model: 'sonnet' },
    project: { model: 'opus', env: { DEBUG: 'true' } },
  });

  it('matches on key and on any scope value, case-insensitively', () => {
    const model = rows.find((r) => r.key === 'model')!;
    expect(matchesQuery(model, 'MODEL')).toBe(true);
    expect(matchesQuery(model, 'sonnet')).toBe(true);
    expect(matchesQuery(model, 'nope')).toBe(false);
    expect(matchesQuery(model, '  ')).toBe(true);
  });

  it('filters by winning scope and query together', () => {
    expect(filterRows(rows, 'project', '').map((r) => r.key)).toEqual(['env.DEBUG', 'model']);
    expect(filterRows(rows, 'default', '').map((r) => r.key)).toEqual(['permissions.defaultMode']);
    expect(filterRows(rows, 'all', 'debug').map((r) => r.key)).toEqual(['env.DEBUG']);
    expect(filterRows(rows, 'global', '')).toEqual([]);
  });
});
