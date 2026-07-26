/**
 * Instance list model (SPEC §4.2 lazy workspace, CLI side). Pure data +
 * transitions, no I/O: the Ink app applies these, and the persistence bead
 * (workspace.json) can layer load/save on top without touching the shape.
 *
 * An instance is a root folder the app knows about. `loaded` instances have
 * been through the engine (● in the list, counts known); the rest are lazy
 * (○, counts unknown until first open).
 *
 * The identity key is the real (symlink-resolved) path so two links to the
 * same folder dedupe to one instance — load-bearing for gxo.6 persistence.
 * Non-existent paths fall back to a lexical resolve.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Instance {
  /** Absolute, resolved root path — the identity key (deduped on this). */
  root: string;
  /** Display name: basename of root. */
  name: string;
  loaded: boolean;
  agentCount?: number;
  findingCount?: number;
}

export interface InstanceList {
  instances: readonly Instance[];
  /** Index of the selected instance; 0 when the list is non-empty. */
  selected: number;
}

export function createInstanceList(): InstanceList {
  return { instances: [], selected: 0 };
}

function normalizeRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved; // not on disk yet — lexical resolve is the best key
  }
}

function toInstance(root: string): Instance {
  const resolved = normalizeRoot(root);
  return { root: resolved, name: path.basename(resolved) || resolved, loaded: false };
}

/** Add one root (lazy); no-op when the resolved root is already present. */
export function addInstance(
  list: InstanceList,
  root: string,
): { list: InstanceList; added: boolean } {
  const instance = toInstance(root);
  if (list.instances.some((i) => i.root === instance.root)) return { list, added: false };
  return { list: { ...list, instances: [...list.instances, instance] }, added: true };
}

/** Add many roots (scan hits); returns how many were new. */
export function addInstances(
  list: InstanceList,
  roots: readonly string[],
): { list: InstanceList; added: number } {
  let next = list;
  let added = 0;
  for (const root of roots) {
    const result = addInstance(next, root);
    next = result.list;
    if (result.added) added += 1;
  }
  return { list: next, added };
}

/** Mark a root as engine-loaded with its counts; no-op for unknown roots. */
export function markLoaded(
  list: InstanceList,
  root: string,
  counts: { agentCount: number; findingCount: number },
): InstanceList {
  const key = normalizeRoot(root);
  return {
    ...list,
    instances: list.instances.map((i) => (i.root === key ? { ...i, loaded: true, ...counts } : i)),
  };
}

/** Move the selection by delta, clamped to the list bounds. */
export function moveSelection(list: InstanceList, delta: number): InstanceList {
  if (list.instances.length === 0) return list;
  const selected = Math.min(Math.max(list.selected + delta, 0), list.instances.length - 1);
  return selected === list.selected ? list : { ...list, selected };
}

export function selectedInstance(list: InstanceList): Instance | undefined {
  return list.instances[list.selected];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 'S'}`;
}

/** `● name · 2 AGENTS · 3 FINDINGS` (loaded) or `○ name · LAZY`. */
export function formatInstanceRow(instance: Instance): string {
  if (!instance.loaded) return `○ ${instance.name} · LAZY`;
  const agents = plural(instance.agentCount ?? 0, 'AGENT');
  const findings = plural(instance.findingCount ?? 0, 'FINDING');
  return `● ${instance.name} · ${agents} · ${findings}`;
}

/** Header line per DESIGN §8: `AGENTCONFIG · <n> INSTANCES · <url>`. */
export function formatHeader(instanceCount: number, url: string): string {
  return `AGENTCONFIG · ${plural(instanceCount, 'INSTANCE')} · ${url}`;
}
