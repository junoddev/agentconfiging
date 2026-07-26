/**
 * Per-instance file watcher + structural report diff (agentconfig-gxo.4, SPEC §4.4).
 *
 * chokidar watches an instance's CONFIG paths (the same paths the scanner
 * collects — KNOWN_FILES / ADDITIONAL_KNOWN_FILES at the root, KNOWN_DIRS
 * subtrees, the scoped-instructions dir) and its HISTORY files under
 * `~/.claude/projects/<slug>/`. Bursts are coalesced with a 150ms debounce.
 * On a settled CONFIG change the ReportStore is invalidated, the engine re-runs
 * (buildReport, via `store.get(..., { fresh:true })`), a STRUCTURAL diff is
 * computed against the previous report, and a small `{type:'report', ...}`
 * message is pushed — CONTENT-FREE: only finding ids / agent kinds, never file
 * bodies or fix patches (the report serializer already strips those to
 * hasFix/fixKind; we push even less). A settled change on a session JSONL that
 * is growing pushes a `{type:'live-session', ...}` pulse instead — session logs
 * are not part of the config manifest, so they never trigger a report re-run.
 *
 * BOUNDING: mirrors the scanner — SKIP_DIRS are ignored, symlinks are never
 * followed (chokidar `followSymlinks:false`), and descent is depth-capped.
 *
 * RESILIENCE: watcher construction and every fs event are wrapped so a bad
 * path, a scan error, or a chokidar 'error' is logged to stderr and the server
 * keeps serving — a watcher fault must never crash the process.
 */

import path from 'node:path';
import { watch as chokidarWatch } from 'chokidar';
import {
  ADDITIONAL_KNOWN_FILES,
  KNOWN_DIRS,
  KNOWN_FILES,
  SKIP_DIRS,
  type DetectedAgent,
} from '../core/index.js';
import type { RegistryInstance } from './registry.js';
import type { ReportStore, ServedReport } from './store.js';

/** SPEC §4.4 debounce: coalesce a burst of fs events into one re-run. */
export const DEFAULT_DEBOUNCE_MS = 150;

/**
 * How deep to descend KNOWN_DIRS subtrees. Real config is shallow
 * (`.claude/agents/x.md`, `.cursor/rules/*.mdc`), so a small cap keeps the
 * watch cheap while still catching every config file. Root files sit at
 * depth 0; this bounds the recursive dir watches like the scanner's maxDepth.
 */
const CONFIG_WATCH_DEPTH = 8;

/** Push-message shapes sent over the WS (small — ids only, never content). */
export type WatcherMessage =
  | { type: 'report'; instance: string; changed: string[] }
  | { type: 'live-session'; instance: string; sessionId: string };

/** Structural diff of two reports — a compact summary of what changed. */
export interface ReportDiff {
  /**
   * Sorted change tokens, each an id/kind only (no content):
   *   `finding-added:<id>`, `finding-resolved:<id>`,
   *   `agent-added:<kind>`, `agent-removed:<kind>`, `agent-changed:<kind>`.
   * `agent-changed` covers a confidence change OR a change to the agent's
   * contributing artifact/file set. Empty ⇒ no structural delta (the client
   * may still refetch — a file body edit changes nothing structurally).
   */
  changed: string[];
}

function agentChanged(before: DetectedAgent, after: DetectedAgent): boolean {
  if (before.confidence !== after.confidence) return true;
  const a = [...before.files].sort();
  const b = [...after.files].sort();
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return true;
  return false;
}

/**
 * Pure structural diff of two served reports. `prev` may be undefined (first
 * run), in which case every finding/agent counts as added. Deterministic:
 * `changed` is sorted.
 */
export function reportDiff(prev: ServedReport | undefined, next: ServedReport): ReportDiff {
  const changed: string[] = [];

  const prevFindings = new Set((prev?.findings ?? []).map((f) => f.id));
  const nextFindings = new Set(next.findings.map((f) => f.id));
  for (const id of nextFindings) if (!prevFindings.has(id)) changed.push(`finding-added:${id}`);
  for (const id of prevFindings) if (!nextFindings.has(id)) changed.push(`finding-resolved:${id}`);

  const prevAgents = new Map((prev?.agents ?? []).map((a) => [a.kind, a]));
  const nextAgents = new Map(next.agents.map((a) => [a.kind, a]));
  for (const [kind, after] of nextAgents) {
    const before = prevAgents.get(kind);
    if (!before) changed.push(`agent-added:${kind}`);
    else if (agentChanged(before, after)) changed.push(`agent-changed:${kind}`);
  }
  for (const kind of prevAgents.keys())
    if (!nextAgents.has(kind)) changed.push(`agent-removed:${kind}`);

  return { changed: changed.sort() };
}

/** Minimal watcher surface we depend on (chokidar's FSWatcher satisfies it). */
export interface WatcherLike {
  on(event: string, handler: (...args: unknown[]) => void): unknown;
  close(): Promise<void>;
}

/** Injectable for tests; defaults to chokidar. */
export type WatchFn = (paths: string[], options: Record<string, unknown>) => WatcherLike;

const defaultWatch: WatchFn = (paths, options) => chokidarWatch(paths, options) as WatcherLike;

function logWatcherError(context: string, err: unknown): void {
  console.error(`agentconfiging watcher: ${context}: ${String(err)}`);
}

/** Ignore any path with a SKIP_DIRS segment (node_modules, .git, dist, ...). */
function ignoredMatcher(p: string): boolean {
  return p.split(/[/\\]+/).some((seg) => SKIP_DIRS.has(seg));
}

/** The config paths to watch for an instance root — mirrors the scanner. */
export function configWatchPaths(root: string): string[] {
  const paths: string[] = [];
  for (const file of KNOWN_FILES) paths.push(path.join(root, file));
  for (const file of ADDITIONAL_KNOWN_FILES) paths.push(path.join(root, file));
  for (const dir of KNOWN_DIRS) paths.push(path.join(root, dir));
  paths.push(path.join(root, '.github', 'instructions'));
  return paths;
}

/**
 * Claude Code's project-slug encoding: every non-alphanumeric char in the
 * absolute cwd becomes '-' (so `/Users/x/my.app` → `-Users-x-my-app`). Used to
 * locate this instance's session dir under `~/.claude/projects/`. The encoding
 * is lossy (the on-disk slug is authoritative), so a mismatch simply means the
 * session dir isn't watched — harmless.
 */
export function slugForRoot(root: string): string {
  return root.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface InstanceWatcherOptions {
  instance: RegistryInstance;
  store: ReportStore;
  /** Runtime home dir (inject os.homedir() at the call site; fakeable in tests). */
  home: string;
  /** Push callback — the WS hub broadcast in production. */
  onMessage: (message: WatcherMessage) => void;
  debounceMs?: number;
  /** Watcher factory override (tests inject a fake). */
  watch?: WatchFn;
}

/**
 * Watches one instance. Lifecycle: `start()` on registry load, `close()` on
 * unload/remove. All timers and the chokidar handle are torn down by `close()`
 * so nothing leaks (matters for tests and for unload).
 */
export class InstanceWatcher {
  readonly #instance: RegistryInstance;
  readonly #store: ReportStore;
  readonly #onMessage: (message: WatcherMessage) => void;
  readonly #debounceMs: number;
  readonly #watch: WatchFn;
  readonly #projectsDir: string;

  #watcher?: WatcherLike;
  #reportTimer?: ReturnType<typeof setTimeout>;
  #sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #prev?: ServedReport;
  #closed = false;

  constructor(opts: InstanceWatcherOptions) {
    this.#instance = opts.instance;
    this.#store = opts.store;
    this.#onMessage = opts.onMessage;
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#watch = opts.watch ?? defaultWatch;
    this.#projectsDir = path.join(opts.home, 'projects');
  }

  /** Begin watching. Never throws — a construction fault is logged and swallowed. */
  start(): void {
    // Baseline: reuse the store's cached report if present, else compute one.
    // This is the same scan the report route needs; capturing it here gives the
    // first diff a real predecessor. A scan failure leaves prev undefined.
    try {
      this.#prev = this.#store.get('project');
    } catch (err) {
      this.#prev = undefined;
      logWatcherError(`baseline scan for ${this.#instance.root}`, err);
    }

    const paths = [
      ...configWatchPaths(this.#instance.root),
      // This instance's session dir only. The runtime-wide ~/.claude/history.jsonl
      // is deliberately NOT watched: it isn't in the config manifest and drives
      // no push, so watching it would only cost a handle for events we drop.
      path.join(this.#projectsDir, slugForRoot(this.#instance.root)),
    ];
    try {
      this.#watcher = this.#watch(paths, {
        persistent: true,
        ignoreInitial: true,
        followSymlinks: false,
        depth: CONFIG_WATCH_DEPTH,
        ignored: ignoredMatcher,
      });
    } catch (err) {
      logWatcherError(`failed to start watcher for ${this.#instance.root}`, err);
      return;
    }
    this.#watcher.on('all', (event: unknown, changedPath: unknown) => {
      try {
        this.#onFsEvent(String(event), String(changedPath));
      } catch (err) {
        logWatcherError('event handling', err);
      }
    });
    this.#watcher.on('error', (err: unknown) => logWatcherError('chokidar', err));
  }

  #isUnderProjects(p: string): boolean {
    return p.startsWith(this.#projectsDir + path.sep);
  }

  #isSessionPath(p: string): boolean {
    return this.#isUnderProjects(p) && p.endsWith('.jsonl');
  }

  #onFsEvent(event: string, changedPath: string): void {
    if (this.#closed) return;
    if (this.#isUnderProjects(changedPath)) {
      // Session-dir traffic never touches the config manifest, so it never
      // triggers a report re-run. A growing session JSONL → live-session pulse;
      // any other file under the dir (e.g. tool-results spill) is ignored.
      if (this.#isSessionPath(changedPath) && (event === 'change' || event === 'add')) {
        this.#scheduleSession(changedPath);
      }
      return;
    }
    this.#scheduleReport();
  }

  #scheduleReport(): void {
    if (this.#reportTimer) clearTimeout(this.#reportTimer);
    this.#reportTimer = setTimeout(() => {
      this.#reportTimer = undefined;
      this.#rerun();
    }, this.#debounceMs);
  }

  #rerun(): void {
    if (this.#closed) return;
    this.#store.invalidate('project');
    let next: ServedReport;
    try {
      next = this.#store.get('project', { fresh: true });
    } catch (err) {
      // A transient scan error keeps the previous report; log and wait for the
      // next change rather than pushing a broken state or throwing.
      logWatcherError(`re-scan for ${this.#instance.root}`, err);
      return;
    }
    const { changed } = reportDiff(this.#prev, next);
    this.#prev = next;
    this.#onMessage({ type: 'report', instance: this.#instance.id, changed });
  }

  #scheduleSession(sessionPath: string): void {
    const sessionId = path.basename(sessionPath, '.jsonl');
    const existing = this.#sessionTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    this.#sessionTimers.set(
      sessionId,
      setTimeout(() => {
        this.#sessionTimers.delete(sessionId);
        if (this.#closed) return;
        this.#onMessage({ type: 'live-session', instance: this.#instance.id, sessionId });
      }, this.#debounceMs),
    );
  }

  /** Tear down all timers and the chokidar handle. Idempotent; never throws. */
  async close(): Promise<void> {
    this.#closed = true;
    if (this.#reportTimer) clearTimeout(this.#reportTimer);
    this.#reportTimer = undefined;
    for (const timer of this.#sessionTimers.values()) clearTimeout(timer);
    this.#sessionTimers.clear();
    const watcher = this.#watcher;
    this.#watcher = undefined;
    if (watcher) {
      try {
        await watcher.close();
      } catch (err) {
        logWatcherError('close', err);
      }
    }
  }
}

/**
 * Owns one InstanceWatcher per loaded instance and implements the registry's
 * lifecycle seam (agentconfig-gxo.4): `onLoad` starts a watcher, `onUnload`
 * stops it. `closeAll` tears everything down on server shutdown.
 */
export class WatcherSupervisor {
  readonly #watchers = new Map<string, InstanceWatcher>();
  readonly #home: string;
  readonly #onMessage: (message: WatcherMessage) => void;
  readonly #debounceMs: number;
  readonly #watch?: WatchFn;

  constructor(opts: {
    home: string;
    onMessage: (message: WatcherMessage) => void;
    debounceMs?: number;
    watch?: WatchFn;
  }) {
    this.#home = opts.home;
    this.#onMessage = opts.onMessage;
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#watch = opts.watch;
  }

  onLoad(instance: RegistryInstance): void {
    if (!instance.store || this.#watchers.has(instance.id)) return;
    const watcher = new InstanceWatcher({
      instance,
      store: instance.store,
      home: this.#home,
      onMessage: this.#onMessage,
      debounceMs: this.#debounceMs,
      ...(this.#watch ? { watch: this.#watch } : {}),
    });
    this.#watchers.set(instance.id, watcher);
    watcher.start();
  }

  onUnload(instance: RegistryInstance): void {
    const watcher = this.#watchers.get(instance.id);
    if (!watcher) return;
    this.#watchers.delete(instance.id);
    void watcher.close();
  }

  get size(): number {
    return this.#watchers.size;
  }

  async closeAll(): Promise<void> {
    const closing = [...this.#watchers.values()].map((w) => w.close());
    this.#watchers.clear();
    await Promise.allSettled(closing);
  }
}
