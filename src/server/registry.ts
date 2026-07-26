/**
 * InstanceRegistry — the multi-root instance model (SPEC §4.2, agentconfig-gxo.6).
 *
 * ONE server process hosts N instances; the UI switches between them. An
 * instance is a root folder the app knows about:
 *
 *   { id, root, markers, loaded, store? }
 *
 * LAZY by design: `add`/`seed` record only {root, markers} — no scan, no
 * store. The full engine run happens on first access via `load()` (which the
 * /api/report route calls on the resolved instance). Idle instances can be
 * `unload()`ed to free memory; the instance stays in the list and re-loads
 * (re-scans) on the next access.
 *
 * INSTANCE IDS are opaque + stable: a hash of the realpath'd root, not the
 * path itself. The URL selector (?instance=<id>) carries the hash; the
 * registry maps it back to a root server-side. This keeps absolute paths out
 * of the client-facing selector and — critically — means a caller CANNOT use
 * ?instance= to make the server scan an arbitrary filesystem path: the param
 * is resolved ONLY against already-registered instances (unknown → the route
 * 404s, never a scan). New roots enter exclusively through the validated
 * `add` flow (POST /api/instances), which realpaths + requires an existing
 * directory.
 *
 * TWO entry points, different trust levels:
 *   - add(input)  — UNTRUSTED (API path arg): realpath + must be an existing
 *                   directory, else InvalidRootError (→ 400). Symlinks are
 *                   resolved so there are no follow-through surprises.
 *   - seed(root)  — TRUSTED (launch cwd + the CLI's own persisted workspace):
 *                   registered without an existence check; a stale/removed
 *                   root simply fails at load() time (→ 500), matching the
 *                   single-store behavior it replaces.
 *
 * WATCHER SEAM (agentconfig-gxo.4): a per-instance file watcher attaches in
 * `load()` (after the store is created) and detaches in `unload()`/`remove()`.
 * The store already exposes `invalidate()` for the watcher to call. The wiring
 * is a pluggable `InstanceLifecycle` (set via `setLifecycle`) so the registry
 * stays free of watcher/WS details: `onLoad` fires once when a store is first
 * created, `onUnload` fires on unload and remove. startServer installs the
 * WatcherSupervisor here.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ReportStore, type ServedReport } from './store.js';

/** A registered root. `store` exists only while loaded (lazy + unloadable). */
export interface RegistryInstance {
  /** Opaque, stable id (hash of `root`); the URL selector value. */
  id: string;
  /** Absolute, realpath-resolved root — the dedupe key. */
  root: string;
  /** Marker entry names discovery attributed to this root (may be empty). */
  markers: string[];
  /** True once the engine store exists (created on first load). */
  loaded: boolean;
  /** Engine cache for this root; undefined until loaded, dropped on unload. */
  store?: ReportStore;
}

/** Client-facing shape of an instance — no engine internals. */
export interface InstanceSummary {
  id: string;
  /** Display name: basename of the root. */
  name: string;
  root: string;
  markers: string[];
  loaded: boolean;
  isDefault: boolean;
}

/** Thrown by `add` when the supplied path is not an existing directory (→ 400). */
export class InvalidRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRootError';
  }
}

/** Store constructor, injectable so tests can count scans / stub the engine. */
export type StoreFactory = (root: string, version: string) => ReportStore;

/**
 * Watcher lifecycle seam (agentconfig-gxo.4). `onLoad` is called once, right
 * after an instance's store is created (so `instance.store` is set); `onUnload`
 * is called on both unload and remove. Both must never throw.
 */
export interface InstanceLifecycle {
  onLoad(instance: RegistryInstance): void;
  onUnload(instance: RegistryInstance): void;
}

/** Hard cap on hosted instances — a sane bound, not a real-world limit. */
export const MAX_INSTANCES = 128;

/** realpath the resolved path, falling back to a lexical resolve when off-disk. */
function normalizeRoot(input: string): string {
  const resolved = path.resolve(input);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export class InstanceRegistry {
  readonly #version: string;
  readonly #makeStore: StoreFactory;
  readonly #byId = new Map<string, RegistryInstance>();
  readonly #byRoot = new Map<string, string>(); // realpath'd root → id
  #defaultId: string | undefined;
  #lifecycle: InstanceLifecycle | undefined;

  constructor(
    version: string,
    makeStore: StoreFactory = (root, v) => new ReportStore(root, v),
  ) {
    this.#version = version;
    this.#makeStore = makeStore;
  }

  /**
   * Install (or clear) the watcher lifecycle seam. Idempotent; safe to call
   * before any instance loads. See {@link InstanceLifecycle}.
   */
  setLifecycle(lifecycle: InstanceLifecycle | undefined): void {
    this.#lifecycle = lifecycle;
  }

  /**
   * Opaque, stable id for a root: first 16 hex of SHA-256(root).
   *
   * ACCEPTED RISK (gxo.6 review, LOW): the hash is UNSALTED, so an id is
   * derivable from a guessed path. That grants nothing — `resolve` only ever
   * returns ALREADY-REGISTERED instances (a guessed id for an unregistered
   * root is a 404, never a scan), so a predictable id is not a capability.
   * Salting would only break id stability across launches. Left unsalted.
   */
  static idFor(root: string): string {
    return createHash('sha256').update(root).digest('hex').slice(0, 16);
  }

  /**
   * Register a TRUSTED root (launch cwd / restored workspace). No existence
   * check — a since-removed root surfaces as a load-time failure, not here.
   * Deduped on the realpath'd root. `makeDefault` (or being the first entry)
   * sets the default instance served when no `?instance=` is given.
   */
  seed(root: string, opts: { markers?: string[]; makeDefault?: boolean } = {}): RegistryInstance {
    return this.#register(normalizeRoot(root), opts.markers ?? [], opts.makeDefault ?? false);
  }

  /**
   * Register an UNTRUSTED root from the add-instance flow. The path MUST
   * realpath to an existing directory; symlinks are resolved (no
   * follow-through surprises). Throws InvalidRootError otherwise (→ 400).
   * Deduped on the realpath'd root: re-adding returns the existing instance.
   */
  add(input: string, opts: { markers?: string[] } = {}): RegistryInstance {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new InvalidRootError('path required');
    }
    const resolved = path.resolve(input);
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      throw new InvalidRootError('no such folder');
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(real);
    } catch {
      throw new InvalidRootError('no such folder');
    }
    if (!stat.isDirectory()) throw new InvalidRootError('not a directory');
    return this.#register(real, opts.markers ?? [], false);
  }

  #register(root: string, markers: string[], makeDefault: boolean): RegistryInstance {
    const existingId = this.#byRoot.get(root);
    if (existingId) {
      const existing = this.#byId.get(existingId) as RegistryInstance;
      if (makeDefault) this.#defaultId = existingId;
      return existing;
    }
    if (this.#byId.size >= MAX_INSTANCES) {
      throw new InvalidRootError('instance limit reached');
    }
    const id = InstanceRegistry.idFor(root);
    const instance: RegistryInstance = { id, root, markers, loaded: false };
    this.#byId.set(id, instance);
    this.#byRoot.set(root, id);
    if (makeDefault || this.#defaultId === undefined) this.#defaultId = id;
    return instance;
  }

  /** Every instance as a client-facing summary (no engine internals). */
  list(): InstanceSummary[] {
    return [...this.#byId.values()].map((i) => this.summary(i));
  }

  summary(instance: RegistryInstance): InstanceSummary {
    // ACCEPTED RISK (gxo.6 review, LOW): `root` is the absolute on-disk path.
    // It is returned to the client so the workspace UI can show which folder
    // an instance is. The server binds loopback-only and every /api response
    // is bearer-token gated (see app.ts), so this reveals local paths only to
    // a caller already holding the session token. Accepted for a local tool.
    return {
      id: instance.id,
      name: path.basename(instance.root) || instance.root,
      root: instance.root,
      markers: instance.markers,
      loaded: instance.loaded,
      isDefault: instance.id === this.#defaultId,
    };
  }

  get defaultId(): string | undefined {
    return this.#defaultId;
  }

  /**
   * Resolve a `?instance=` selector to a known instance, or undefined.
   *
   * - undefined/empty → the default instance (launch cwd).
   * - an id → that instance.
   * - a path → matched against ALREADY-REGISTERED roots ONLY (realpath, then
   *   byRoot lookup). An unregistered path returns undefined — it is NEVER
   *   scanned or added here, so the selector cannot be an fs-scan primitive.
   */
  resolve(param: string | undefined): RegistryInstance | undefined {
    if (param === undefined || param === '') {
      return this.#defaultId ? this.#byId.get(this.#defaultId) : undefined;
    }
    const byId = this.#byId.get(param);
    if (byId) return byId;
    let real: string;
    try {
      real = fs.realpathSync(path.resolve(param));
    } catch {
      return undefined; // not on disk → certainly not registered
    }
    const id = this.#byRoot.get(real);
    return id ? this.#byId.get(id) : undefined;
  }

  /**
   * Lazily create the instance's engine store (the first scan happens on the
   * store's first `get`, which the report route calls right after). Marks the
   * instance loaded. Re-loading after an unload builds a fresh store → re-scans.
   */
  load(instance: RegistryInstance): ReportStore {
    if (!instance.store) {
      instance.store = this.#makeStore(instance.root, this.#version);
      instance.loaded = true;
      // WATCHER SEAM (gxo.4): attach a per-instance watcher now that the store
      // exists; it calls `instance.store.invalidate()` on relevant fs changes.
      this.#lifecycle?.onLoad(instance);
    }
    return instance.store;
  }

  /** Compute (or return cached) the report for an instance, loading it lazily. */
  report(instance: RegistryInstance, opts: { fresh?: boolean } = {}): ServedReport {
    return this.load(instance).get('project', opts);
  }

  /**
   * Drop the instance's store to free memory; keep it in the list. Idempotent.
   * Returns false for an unknown id. The next `load()` re-scans.
   */
  unload(id: string): boolean {
    const instance = this.#byId.get(id);
    if (!instance) return false;
    // WATCHER SEAM (gxo.4): detach this instance's watcher before dropping.
    this.#lifecycle?.onUnload(instance);
    instance.store = undefined;
    instance.loaded = false;
    return true;
  }

  /** Remove an instance entirely. If it was the default, the default falls back. */
  remove(id: string): boolean {
    const instance = this.#byId.get(id);
    if (!instance) return false;
    // WATCHER SEAM (gxo.4): detach this instance's watcher before removal.
    this.#lifecycle?.onUnload(instance);
    this.#byId.delete(id);
    this.#byRoot.delete(instance.root);
    if (this.#defaultId === id) {
      const next = this.#byId.keys().next();
      this.#defaultId = next.done ? undefined : next.value;
    }
    return true;
  }

  get size(): number {
    return this.#byId.size;
  }
}
