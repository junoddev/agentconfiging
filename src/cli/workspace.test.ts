/**
 * Workspace persistence tests (agentconfig-gxo.6): round-trip, XDG/env
 * overrides, and adversarial-data discipline (corrupt/malformed → empty list,
 * never a throw), plus the size cap.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_WORKSPACE_INSTANCES,
  WORKSPACE_VERSION,
  addWorkspaceRoot,
  loadWorkspace,
  removeWorkspaceRoot,
  resolveStateDir,
  resolveWorkspacePath,
  saveWorkspace,
  type Workspace,
} from './workspace.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});
function makeTempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-ws-')));
  tempDirs.push(dir);
  return dir;
}

const HOME = '/home/user';

describe('path resolution (mirrors logs.ts overrides)', () => {
  it('AGENTCONFIGING_STATE_DIR overrides everything', () => {
    const dir = resolveStateDir({ AGENTCONFIGING_STATE_DIR: '/custom/state', XDG_STATE_HOME: '/xdg' }, HOME);
    expect(dir).toBe('/custom/state');
    expect(resolveWorkspacePath({ AGENTCONFIGING_STATE_DIR: '/custom/state' }, HOME)).toBe(
      '/custom/state/workspace.json',
    );
  });

  it('then XDG_STATE_HOME, then ~/.local/state', () => {
    expect(resolveStateDir({ XDG_STATE_HOME: '/xdg' }, HOME)).toBe('/xdg/agentconfiging');
    expect(resolveStateDir({}, HOME)).toBe('/home/user/.local/state/agentconfiging');
    expect(resolveWorkspacePath({}, HOME)).toBe('/home/user/.local/state/agentconfiging/workspace.json');
  });

  it('blank overrides are ignored', () => {
    expect(resolveStateDir({ AGENTCONFIGING_STATE_DIR: '  ', XDG_STATE_HOME: '' }, HOME)).toBe(
      '/home/user/.local/state/agentconfiging',
    );
  });
});

describe('round-trip', () => {
  it('save → load restores the list, all entries lazy (roots + addedAt only)', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    const ws: Workspace = {
      version: WORKSPACE_VERSION,
      instances: [
        { root: '/tmp/proj-a', addedAt: '2026-07-26T12:00:00.000Z' },
        { root: '/tmp/proj-b', addedAt: '2026-07-26T13:00:00.000Z' },
      ],
    };
    saveWorkspace(file, ws);
    expect(loadWorkspace(file)).toEqual(ws);
  });

  it('the on-disk file is 0600', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    saveWorkspace(file, { version: WORKSPACE_VERSION, instances: [] });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('creates the state dir eagerly', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'nested', 'deep', 'workspace.json');
    saveWorkspace(file, { version: WORKSPACE_VERSION, instances: [] });
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('adversarial-data discipline', () => {
  it('missing file → empty list, no throw', () => {
    expect(loadWorkspace('/no/such/workspace.json')).toEqual({
      version: WORKSPACE_VERSION,
      instances: [],
    });
  });

  it('corrupt JSON → empty list, no throw', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    fs.writeFileSync(file, '{ this is not json ][');
    expect(loadWorkspace(file).instances).toEqual([]);
  });

  it('wrong-shaped payloads → empty list; bad entries are dropped one-by-one', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');

    fs.writeFileSync(file, JSON.stringify({ instances: 'nope' }));
    expect(loadWorkspace(file).instances).toEqual([]);

    fs.writeFileSync(file, JSON.stringify(['not', 'an', 'object']));
    expect(loadWorkspace(file).instances).toEqual([]);

    fs.writeFileSync(
      file,
      JSON.stringify({
        instances: [
          { root: '/tmp/good', addedAt: '2026-01-01T00:00:00.000Z' },
          { root: 123 }, // bad root type — dropped
          { addedAt: 'x' }, // missing root — dropped
          { root: '   ' }, // blank root — dropped
          { root: '/tmp/good' }, // duplicate root — dropped
          { root: '/tmp/no-timestamp' }, // missing addedAt → epoch default
        ],
      }),
    );
    const loaded = loadWorkspace(file);
    expect(loaded.instances.map((e) => e.root)).toEqual(['/tmp/good', '/tmp/no-timestamp']);
    expect(loaded.instances[1]!.addedAt).toBe(new Date(0).toISOString());
  });

  it('does not prototype-pollute via __proto__/constructor keys (gxo.6 review)', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    // Raw JSON text: __proto__ at the top level AND inside an entry, plus a
    // constructor key. loadWorkspace must copy only root/addedAt into fresh
    // objects — never merge these into any prototype.
    fs.writeFileSync(
      file,
      '{"__proto__":{"polluted":"yes"},"instances":[' +
        '{"root":"/tmp/ok","__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"}},' +
        '{"root":"/tmp/two"}]}',
    );
    const loaded = loadWorkspace(file);
    expect(loaded.instances.map((e) => e.root)).toEqual(['/tmp/ok', '/tmp/two']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('treats absolute / traversal "evil" roots as inert plain strings (gxo.6 review)', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    // Persistence stores strings verbatim; validation/scoping happens later at
    // the registry ADD boundary (realpath + must-exist). Loading these never
    // scans or resolves them — they are just data here.
    fs.writeFileSync(
      file,
      JSON.stringify({
        instances: [
          { root: '/etc/passwd', addedAt: '2026-01-01T00:00:00.000Z' },
          { root: '../../../../etc/shadow', addedAt: '2026-01-01T00:00:00.000Z' },
          { root: '/', addedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    );
    expect(loadWorkspace(file).instances.map((e) => e.root)).toEqual([
      '/etc/passwd',
      '../../../../etc/shadow',
      '/',
    ]);
  });
});

describe('size cap', () => {
  it('load and save both cap the list at MAX_WORKSPACE_INSTANCES', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'workspace.json');
    const many = Array.from({ length: MAX_WORKSPACE_INSTANCES + 10 }, (_, i) => ({
      root: `/tmp/p-${i}`,
      addedAt: new Date(0).toISOString(),
    }));
    fs.writeFileSync(file, JSON.stringify({ instances: many }));
    expect(loadWorkspace(file).instances).toHaveLength(MAX_WORKSPACE_INSTANCES);

    saveWorkspace(file, { version: WORKSPACE_VERSION, instances: many });
    expect(loadWorkspace(file).instances).toHaveLength(MAX_WORKSPACE_INSTANCES);
  });
});

describe('pure add/remove transitions', () => {
  const now = new Date('2026-07-26T12:00:00.000Z');
  it('addWorkspaceRoot appends once (dedupe) with addedAt', () => {
    let ws: Workspace = { version: WORKSPACE_VERSION, instances: [] };
    ws = addWorkspaceRoot(ws, '/tmp/a', now);
    expect(ws.instances).toEqual([{ root: '/tmp/a', addedAt: now.toISOString() }]);
    const same = addWorkspaceRoot(ws, '/tmp/a', now);
    expect(same).toBe(ws); // no-op returns the same reference
  });

  it('removeWorkspaceRoot drops the matching root', () => {
    const ws = addWorkspaceRoot({ version: WORKSPACE_VERSION, instances: [] }, '/tmp/a', now);
    expect(removeWorkspaceRoot(ws, '/tmp/a').instances).toEqual([]);
    expect(removeWorkspaceRoot(ws, '/tmp/missing').instances).toEqual(ws.instances);
  });
});
