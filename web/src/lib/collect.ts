/**
 * Generic file collectors for the config-editor pages (extracted from the shape
 * shared by rules / instructions / skills / memory / artifacts logic modules:
 * iterate detected agents → each file, classify, DEDUPE by path (first writer
 * wins), then sort deterministically so the lists never jitter on refetch).
 *
 * The per-page `collect*` / `collectGlobal*` / `group*ByRoot` helpers are meant
 * to be expressed in terms of these — supplying only their own `classify` (which
 * also does path filtering) and, when the order isn't a plain path sort, a
 * `compare`. All input is UNTRUSTED config data; these are pure derivations.
 */

/** The one field every collected item must carry — its dedupe/selection key. */
export interface HasPath {
  path: string;
}

/** The minimal agent shape the collectors read (mirrors `DetectedAgent`). */
export interface AgentFiles {
  files: readonly string[];
}

/** Default order: by `path`, `localeCompare` — matches the string-set collectors
 *  (instructions / memory / artifacts). */
function byPath<T extends HasPath>(a: T, b: T): number {
  return a.path.localeCompare(b.path);
}

/**
 * Collect every file referenced by any agent that `classify` accepts,
 * de-duplicated by `path` (first classification of a path wins) and sorted by
 * `compare` (default: `path` localeCompare).
 *
 * `classify` returns the collected item (which must include a `path`) or `null`
 * to reject the file. String-list collectors pass `p => ({ path: p })` (or a
 * predicate wrapper) and `.map(e => e.path)` the result; entry collectors return
 * their richer shape (e.g. `RuleEntry`, `SkillEntry`) and pass their multi-key
 * `compare`.
 */
export function collectFiles<T extends HasPath>(
  agents: readonly AgentFiles[],
  classify: (path: string) => T | null,
  compare: (a: T, b: T) => number = byPath,
): T[] {
  const byKey = new Map<string, T>();
  for (const agent of agents) {
    for (const file of agent.files) {
      const item = classify(file);
      if (item && !byKey.has(item.path)) byKey.set(item.path, item);
    }
  }
  return [...byKey.values()].sort(compare);
}

/** A machine-global report entry: a config-dir `root` and its detected agents.
 *  Concrete entries may carry more (`dir`, `findings`, …) — `classify` receives
 *  the whole entry so it can branch on those. */
export interface GlobalSource {
  root: string;
  agents: readonly AgentFiles[];
}

/**
 * Collect every global (inherited) file across `entries` that `classify`
 * accepts, de-duplicated by `path` (first wins) and sorted by `compare`
 * (default: `path` localeCompare).
 *
 * `classify` receives the whole `entry` (for its `root` / `dir`) and one
 * entry-relative `rel` path, and returns the collected item — whose `path` MUST
 * be the ABSOLUTE root-joined key (build it with `joinGlobalPath(entry.root,
 * rel)`) — or `null` to reject. Absolute paths are read-only selectors: no write
 * flow ever derives a write target from them.
 */
export function collectGlobalFiles<E extends GlobalSource, T extends HasPath>(
  entries: readonly E[],
  classify: (entry: E, rel: string) => T | null,
  compare: (a: T, b: T) => number = byPath,
): T[] {
  const byKey = new Map<string, T>();
  for (const entry of entries) {
    for (const agent of entry.agents) {
      for (const rel of agent.files) {
        const item = classify(entry, rel);
        if (item && !byKey.has(item.path)) byKey.set(item.path, item);
      }
    }
  }
  return [...byKey.values()].sort(compare);
}

/** One global root's collected items, for a `GLOBAL · ~/.claude` list heading. */
export interface RootGroup<T> {
  root: string;
  items: T[];
}

/**
 * Group already-collected items by their `root`, PRESERVING the collector's
 * order (first-seen root order; items in their original order within a group).
 * Empty input ⇒ no groups (never an empty GLOBAL heading). Callers that expose a
 * named array (`files` / `rules`) map `{ root, items }` onto their own shape.
 */
export function groupByRoot<T extends { root: string }>(items: readonly T[]): RootGroup<T>[] {
  const groups = new Map<string, RootGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.root) ?? { root: item.root, items: [] };
    group.items.push(item);
    groups.set(item.root, group);
  }
  return [...groups.values()];
}
