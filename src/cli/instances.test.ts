import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addInstance,
  addInstances,
  createInstanceList,
  formatHeader,
  formatInstanceRow,
  markLoaded,
  moveSelection,
  selectedInstance,
  type InstanceList,
} from './instances.js';

const A = path.resolve('/tmp/proj-a');
const B = path.resolve('/tmp/proj-b');
const C = path.resolve('/tmp/proj-c');

function listWith(...roots: string[]): InstanceList {
  return addInstances(createInstanceList(), roots).list;
}

describe('addInstance', () => {
  it('adds a lazy instance with basename as name', () => {
    const { list, added } = addInstance(createInstanceList(), A);
    expect(added).toBe(true);
    expect(list.instances).toEqual([{ root: A, name: 'proj-a', loaded: false }]);
    expect(list.selected).toBe(0);
  });

  it('dedupes on the resolved root (trailing slash, relative segments)', () => {
    const first = addInstance(createInstanceList(), A).list;
    const again = addInstance(first, `${A}${path.sep}`);
    const viaDots = addInstance(again.list, path.join(A, '..', 'proj-a'));
    expect(again.added).toBe(false);
    expect(viaDots.added).toBe(false);
    expect(viaDots.list.instances).toHaveLength(1);
  });
});

describe('addInstance symlink dedupe (real paths)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0)
      fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  });

  it('a symlink to an already-added real dir does not add a second instance', () => {
    const holder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfiging-inst-')));
    tempDirs.push(holder);
    const real = path.join(holder, 'real');
    const link = path.join(holder, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link, 'dir');

    const first = addInstance(createInstanceList(), real);
    expect(first.added).toBe(true);
    expect(first.list.instances[0]?.root).toBe(real);

    const second = addInstance(first.list, link);
    expect(second.added).toBe(false);
    expect(second.list.instances).toHaveLength(1);
  });
});

describe('addInstances', () => {
  it('adds many and counts only new roots', () => {
    const base = listWith(A);
    const { list, added } = addInstances(base, [A, B, C]);
    expect(added).toBe(2);
    expect(list.instances.map((i) => i.root)).toEqual([A, B, C]);
  });
});

describe('markLoaded', () => {
  it('sets loaded + counts for the matching root', () => {
    const list = markLoaded(listWith(A, B), A, { agentCount: 2, findingCount: 3 });
    expect(list.instances[0]).toEqual({
      root: A,
      name: 'proj-a',
      loaded: true,
      agentCount: 2,
      findingCount: 3,
    });
    expect(list.instances[1]?.loaded).toBe(false);
  });

  it('is a no-op for unknown roots', () => {
    const list = listWith(A);
    expect(markLoaded(list, B, { agentCount: 1, findingCount: 1 })).toEqual(list);
  });
});

describe('moveSelection', () => {
  it('moves and clamps at both ends', () => {
    let list = listWith(A, B, C);
    expect(moveSelection(list, -1).selected).toBe(0); // clamp low
    list = moveSelection(list, 1);
    expect(list.selected).toBe(1);
    list = moveSelection(list, 1);
    list = moveSelection(list, 1);
    expect(list.selected).toBe(2); // clamp high
    expect(selectedInstance(list)?.root).toBe(C);
  });

  it('tolerates an empty list', () => {
    const empty = createInstanceList();
    expect(moveSelection(empty, 1)).toBe(empty);
    expect(selectedInstance(empty)).toBeUndefined();
  });
});

describe('formatting (DESIGN §8 voice)', () => {
  it('loaded rows show ● with counts', () => {
    const list = markLoaded(listWith(A), A, { agentCount: 2, findingCount: 3 });
    expect(formatInstanceRow(list.instances[0]!)).toBe('● proj-a · 2 AGENTS · 3 FINDINGS');
  });

  it('singulars read correctly', () => {
    const list = markLoaded(listWith(A), A, { agentCount: 1, findingCount: 1 });
    expect(formatInstanceRow(list.instances[0]!)).toBe('● proj-a · 1 AGENT · 1 FINDING');
  });

  it('lazy rows show ○ LAZY', () => {
    expect(formatInstanceRow(listWith(B).instances[0]!)).toBe('○ proj-b · LAZY');
  });

  it('header follows AGENTCONFIG · <n> INSTANCES · <url>', () => {
    expect(formatHeader(2, 'http://127.0.0.1:4242')).toBe(
      'AGENTCONFIG · 2 INSTANCES · http://127.0.0.1:4242',
    );
    expect(formatHeader(1, 'u')).toBe('AGENTCONFIG · 1 INSTANCE · u');
  });
});
