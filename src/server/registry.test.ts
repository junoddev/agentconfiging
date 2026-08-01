/**
 * InstanceRegistry unit tests (agentconfig-gxo.6): the multi-root model —
 * lazy load, unload/re-scan, opaque stable ids, path/id resolution that never
 * scans an arbitrary path, and the validated vs. trusted entry points.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InstanceRegistry, InvalidRootError, MAX_INSTANCES } from './registry.js';
import type { ReportStore } from './store.js';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});
function makeTempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-reg-')));
  tempDirs.push(dir);
  return dir;
}

/**
 * A registry whose stores are cheap fakes: `builds` records each store
 * construction (the lazy-load moment) and `scans` records each `get` (the
 * engine run). Lets tests assert exactly when a scan happens.
 */
function countingRegistry(version = '1.2.3') {
  const builds: string[] = [];
  const scans: string[] = [];
  const contextCosts: { root: string; fresh?: boolean }[] = [];
  const registry = new InstanceRegistry(version, (root) => {
    builds.push(root);
    const fake = {
      get: () => {
        scans.push(root);
        return { root, scope: 'project' } as unknown;
      },
      contextHealth: () => ({ totalBytes: 0, fileCount: 0, budgetBytes: 1 }),
      contextCost: (_scope: string, opts: { fresh?: boolean } = {}) => {
        contextCosts.push({ root, fresh: opts.fresh });
        return { budgetTokens: 100000, agents: [] };
      },
      invalidate: () => undefined,
    };
    return fake as unknown as ReportStore;
  });
  return { registry, builds, scans, contextCosts };
}

describe('idFor', () => {
  it('is stable, opaque (not the path), and root-specific', () => {
    const a = InstanceRegistry.idFor('/tmp/proj-a');
    expect(a).toBe(InstanceRegistry.idFor('/tmp/proj-a')); // stable across calls
    expect(a).not.toContain('/'); // opaque — no path leak
    expect(a).not.toContain('proj-a');
    expect(a).not.toBe(InstanceRegistry.idFor('/tmp/proj-b'));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('add (untrusted path validation)', () => {
  it('accepts an existing directory and dedupes on the real path', () => {
    const dir = makeTempDir();
    const { registry } = countingRegistry();
    const first = registry.add(dir);
    expect(first.loaded).toBe(false);
    expect(first.store).toBeUndefined();
    // Re-add via a trailing slash / relative segments → same instance.
    const again = registry.add(`${dir}${path.sep}`);
    expect(again.id).toBe(first.id);
    expect(registry.size).toBe(1);
  });

  it('rejects a nonexistent path and a file (→ InvalidRootError, mapped to 400)', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, 'x');
    const { registry } = countingRegistry();
    expect(() => registry.add(path.join(dir, 'missing'))).toThrow(InvalidRootError);
    expect(() => registry.add(file)).toThrow(InvalidRootError);
    expect(() => registry.add('')).toThrow(InvalidRootError);
    expect(registry.size).toBe(0);
  });

  it('resolves symlinks so a link and its target are one instance (no surprises)', () => {
    const holder = makeTempDir();
    const real = path.join(holder, 'real');
    const link = path.join(holder, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link, 'dir');
    const { registry } = countingRegistry();
    const viaReal = registry.add(real);
    const viaLink = registry.add(link);
    expect(viaLink.id).toBe(viaReal.id);
    expect(viaReal.root).toBe(fs.realpathSync(real));
    expect(registry.size).toBe(1);
  });

  it('enforces the instance cap', () => {
    const { registry } = countingRegistry();
    for (let i = 0; i < MAX_INSTANCES; i += 1) registry.seed(`/tmp/cap-${i}`);
    expect(() => registry.add(makeTempDir())).toThrow(InvalidRootError);
  });
});

describe('seed (trusted, no existence check)', () => {
  it('registers a nonexistent root; failure surfaces only at load time', () => {
    const { registry } = countingRegistry();
    const ghost = registry.seed('/tmp/does-not-exist-xyz', { makeDefault: true });
    expect(ghost.loaded).toBe(false);
    expect(registry.defaultId).toBe(ghost.id);
  });
});

describe('lazy load + unload', () => {
  it('does NOT build a store or scan until the instance is loaded', () => {
    const dir = makeTempDir();
    const { registry, builds, scans } = countingRegistry();
    const inst = registry.add(dir);
    expect(builds).toEqual([]); // added but never scanned
    expect(scans).toEqual([]);

    registry.report(inst); // first access
    expect(builds).toEqual([inst.root]);
    expect(scans).toEqual([inst.root]);
    expect(inst.loaded).toBe(true);
  });

  it('unload drops the store; the next load rebuilds and re-scans', () => {
    const dir = makeTempDir();
    const { registry, builds, scans } = countingRegistry();
    const inst = registry.add(dir);
    registry.report(inst);
    expect(builds).toHaveLength(1);

    expect(registry.unload(inst.id)).toBe(true);
    expect(inst.store).toBeUndefined();
    expect(inst.loaded).toBe(false);

    registry.report(inst); // must rebuild + re-scan, not reuse
    expect(builds).toHaveLength(2);
    expect(scans).toHaveLength(2);
    expect(inst.loaded).toBe(true);
  });

  it('unload/remove of an unknown id return false', () => {
    const { registry } = countingRegistry();
    expect(registry.unload('deadbeefdeadbeef')).toBe(false);
    expect(registry.remove('deadbeefdeadbeef')).toBe(false);
  });

  it('contextCost loads lazily and forwards fresh semantics to the store', () => {
    const dir = makeTempDir();
    const { registry, builds, scans, contextCosts } = countingRegistry();
    const inst = registry.add(dir);

    expect(registry.contextCost(inst)).toEqual({ budgetTokens: 100000, agents: [] });
    expect(builds).toEqual([inst.root]);
    expect(scans).toEqual([]);
    expect(contextCosts).toEqual([{ root: inst.root, fresh: undefined }]);

    registry.contextCost(inst, { fresh: true });
    expect(builds).toHaveLength(1);
    expect(contextCosts).toEqual([
      { root: inst.root, fresh: undefined },
      { root: inst.root, fresh: true },
    ]);
  });
});

describe('resolve (selector never scans an arbitrary path)', () => {
  it('undefined → default; known id → instance; unknown id → undefined', () => {
    const dir = makeTempDir();
    const { registry } = countingRegistry();
    const def = registry.seed('/tmp/default-root', { makeDefault: true });
    const added = registry.add(dir);
    expect(registry.resolve(undefined)?.id).toBe(def.id);
    expect(registry.resolve(added.id)?.id).toBe(added.id);
    expect(registry.resolve('unknown-id-0000')).toBeUndefined();
  });

  it('a path resolves ONLY if already registered — an unregistered path is undefined', () => {
    const registered = makeTempDir();
    const stranger = makeTempDir(); // exists on disk but never added
    const { registry, builds } = countingRegistry();
    registry.add(registered);
    expect(registry.resolve(registered)?.root).toBe(fs.realpathSync(registered));
    expect(registry.resolve(stranger)).toBeUndefined(); // not registered → no match
    expect(registry.resolve('/etc')).toBeUndefined();
    expect(builds).toEqual([]); // resolving never builds a store / scans
  });

  it('empty registry: resolve(undefined) is undefined (no default yet)', () => {
    const { registry } = countingRegistry();
    expect(registry.resolve(undefined)).toBeUndefined();
  });
});

describe('remove + default fallback', () => {
  it('removing the default promotes another instance to default', () => {
    const { registry } = countingRegistry();
    const a = registry.seed('/tmp/a', { makeDefault: true });
    const b = registry.seed('/tmp/b');
    expect(registry.defaultId).toBe(a.id);
    expect(registry.remove(a.id)).toBe(true);
    expect(registry.defaultId).toBe(b.id);
    expect(registry.size).toBe(1);
  });
});

describe('list / summary', () => {
  it('summaries carry name, root, loaded, isDefault — no engine internals', () => {
    const dir = makeTempDir();
    const { registry } = countingRegistry();
    registry.seed(dir, { makeDefault: true });
    const [summary] = registry.list();
    expect(summary).toEqual({
      id: InstanceRegistry.idFor(fs.realpathSync(dir)),
      name: path.basename(dir),
      root: fs.realpathSync(dir),
      markers: [],
      loaded: false,
      isDefault: true,
    });
  });
});
