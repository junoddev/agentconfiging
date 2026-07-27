/**
 * known-projects — SUGGESTED workspace instances from THIS machine's runtime
 * history (SPEC §4.2 "known-project suggestions"; §5 row 23). Registered under
 * `/api`, so this route INHERITS the hardened app's gates (Host allowlist,
 * bearer token, same-origin/CSRF). It adds no gate of its own.
 *
 * LOCAL-ONLY read: candidates are the project roots seen under `~/.claude`
 * (session logs), read through the committed `claudeAdapter` (src/core/history).
 * The server binds loopback only, so this on-disk history is never exposed
 * off-machine.
 *
 * SLUG IS LOSSY — cwd COMES FROM THE SESSION ENTRIES: a claude project slug dir
 * (`~/.claude/projects/<slug>/`) is a lossy encoding (`/` and `.` both become
 * `-`), so two distinct working directories can collide into ONE slug dir. The
 * real cwd is therefore read from each session file's in-file entries via
 * {@link readSessionCwd} — NEVER decoded from the slug directory name. Dedupe is
 * on the resolved cwd, so a colliding slug still yields both real roots.
 *
 * CONTENT-FREE responses: only project ROOTS + light metadata (a session count
 * and a last-seen timestamp) cross the wire — never any message content. Roots
 * are filesystem paths (adversarial text); the UI renders them as text nodes.
 *
 * BOUNDED work: a huge `~/.claude` must never hang the server. Discovery lists
 * every session file (cheap), but only the {@link DEFAULT_KNOWN_SESSION_CAP}
 * MOST-RECENT files (by mtime) have their cwd read (a bounded per-file read).
 * The disk-derived candidate set is cached with a short TTL; the already-
 * registered filter is applied FRESH per request (so an add reflects at once).
 *
 * SUGGESTIONS ONLY: a candidate is offered only when its resolved root EXISTS on
 * disk (a since-removed cwd is skipped) and is NOT already a registered instance.
 * The suggestion feeds the EXISTING add flow (POST /api/instances) — this route
 * never adds anything itself.
 */

import { realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import { claudeAdapter, readSessionCwd } from '../core/index.js';
import type { InstanceRegistry } from './registry.js';

/** Most-recent session files whose cwd is read per load (bounds the work). */
export const DEFAULT_KNOWN_SESSION_CAP = 400;
/** How long the disk-derived candidate set is reused before a fresh scan (ms). */
export const DEFAULT_KNOWN_TTL_MS = 30_000;

/**
 * Resolve a session cwd to its canonical, on-disk root, or undefined when it no
 * longer exists. The default realpath's the path (matching how the registry
 * normalizes roots, so the already-registered filter compares like-for-like) and
 * treats any error (ENOENT, permission) as "does not exist". Injectable so tests
 * can decouple existence from a temp fixture.
 */
export type RootResolver = (cwd: string) => Promise<string | undefined>;

async function realpathResolver(cwd: string): Promise<string | undefined> {
  try {
    const real = await realpath(cwd);
    const st = await stat(real);
    return st.isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

export interface KnownProjectsConfig {
  /** The registry the already-registered filter reads current roots from. */
  registry: InstanceRegistry;
  /**
   * The claude runtime home dir (holds `projects/`). Defaults to `~/.claude`.
   * Injectable so tests point it at a temp fixture and exercise the REAL adapter
   * with no touch to the developer's home.
   */
  home?: string;
  /** Clock anchor. Defaults to `Date.now`. */
  now?: () => number;
  /** Most-recent session files read per load. Defaults to {@link DEFAULT_KNOWN_SESSION_CAP}. */
  sessionCap?: number;
  /** Candidate-set cache TTL in ms. Defaults to {@link DEFAULT_KNOWN_TTL_MS}. */
  ttlMs?: number;
  /** Existence/canonicalization seam. Defaults to a realpath-based resolver. */
  resolveRoot?: RootResolver;
}

// ── Wire types (mirrored in web/src/api/types.ts) ─────────────────────────────

/** One suggested project root + light, content-free metadata. */
export interface KnownProject {
  /** Absolute, canonical (realpath'd) project root — a filesystem path (text). */
  root: string;
  /** ISO timestamp of the most-recent session touching this root, when known. */
  lastSeen?: string;
  /** Sessions (within the scanned window) whose cwd resolved to this root. */
  sessionCount: number;
}

/** GET /api/known-projects payload — suggested roots for the add flow. */
export interface KnownProjectsResponse {
  projects: KnownProject[];
  /** Session files discovered on disk before the cap was applied. */
  sessionsTotal: number;
  /** True when discovery found more files than the cap (window is partial). */
  capped: boolean;
}

/** A disk-derived candidate, before the (per-request) already-registered filter. */
interface Candidate {
  root: string;
  sessionCount: number;
  lastSeenMs?: number;
}

interface LoadedCandidates {
  candidates: Candidate[];
  sessionsTotal: number;
  capped: boolean;
}

/**
 * Bounded, TTL-cached reader for the known-project candidate set under `home`.
 * Discovery lists every session file; only the `cap` most-recent (by mtime) have
 * their cwd read. Resilient: a missing `~/.claude`, unreadable files, or a cwd
 * that no longer exists all degrade to fewer/no candidates, never an error.
 */
export class KnownProjectsCache {
  readonly #home: string;
  readonly #cap: number;
  readonly #ttlMs: number;
  readonly #resolveRoot: RootResolver;
  #entry: { at: number; value: LoadedCandidates } | undefined;
  #inflight: Promise<LoadedCandidates> | undefined;

  constructor(home: string, cap: number, ttlMs: number, resolveRoot: RootResolver) {
    this.#home = home;
    this.#cap = cap;
    this.#ttlMs = ttlMs;
    this.#resolveRoot = resolveRoot;
  }

  /** Drop the cached read — forces a fresh scan on the next load. */
  invalidate(): void {
    this.#entry = undefined;
  }

  load(nowMs: number): Promise<LoadedCandidates> {
    if (this.#entry && nowMs - this.#entry.at < this.#ttlMs) {
      return Promise.resolve(this.#entry.value);
    }
    if (!this.#inflight) {
      this.#inflight = this.#read()
        .then((value) => {
          this.#entry = { at: nowMs, value };
          return value;
        })
        .finally(() => {
          this.#inflight = undefined;
        });
    }
    return this.#inflight;
  }

  async #read(): Promise<LoadedCandidates> {
    let refs;
    try {
      refs = await claudeAdapter.discoverSessions(this.#home);
    } catch {
      // A missing / unreadable home yields no suggestions, never an error.
      return { candidates: [], sessionsTotal: 0, capped: false };
    }
    const sessionsTotal = refs.length;

    // Order by mtime (most-recent first) so the cap keeps the freshest window.
    const withMtime = await Promise.all(
      refs.map(async (ref) => {
        try {
          const s = await stat(ref.path);
          return { path: ref.path, mtimeMs: s.mtimeMs };
        } catch {
          return { path: ref.path, mtimeMs: 0 };
        }
      }),
    );
    withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const capped = withMtime.length > this.#cap;
    const selected = withMtime.slice(0, this.#cap);

    // Group by the RAW session cwd (read from in-file entries, never the slug).
    const byCwd = new Map<string, { sessionCount: number; lastSeenMs: number }>();
    for (const { path: filePath, mtimeMs } of selected) {
      let cwd: string | undefined;
      try {
        cwd = await readSessionCwd(filePath);
      } catch {
        cwd = undefined; // a vanished / unreadable file must not abort the load.
      }
      if (cwd === undefined) continue;
      const prev = byCwd.get(cwd);
      if (prev) {
        prev.sessionCount += 1;
        if (mtimeMs > prev.lastSeenMs) prev.lastSeenMs = mtimeMs;
      } else {
        byCwd.set(cwd, { sessionCount: 1, lastSeenMs: mtimeMs });
      }
    }

    // Resolve each distinct raw cwd to a canonical, existing root and dedupe on
    // it — distinct raw cwds may canonicalize to the same root (symlinks), and a
    // cwd that no longer exists is dropped here.
    const byRoot = new Map<string, { sessionCount: number; lastSeenMs: number }>();
    for (const [cwd, meta] of byCwd) {
      const root = await this.#resolveRoot(cwd);
      if (root === undefined) continue;
      const prev = byRoot.get(root);
      if (prev) {
        prev.sessionCount += meta.sessionCount;
        if (meta.lastSeenMs > prev.lastSeenMs) prev.lastSeenMs = meta.lastSeenMs;
      } else {
        byRoot.set(root, { sessionCount: meta.sessionCount, lastSeenMs: meta.lastSeenMs });
      }
    }

    const candidates: Candidate[] = [...byRoot.entries()].map(([root, meta]) => ({
      root,
      sessionCount: meta.sessionCount,
      ...(meta.lastSeenMs > 0 ? { lastSeenMs: meta.lastSeenMs } : {}),
    }));
    return { candidates, sessionsTotal, capped };
  }
}

/** Suggestions ordering: most-recently-seen first, then by root for stability. */
function byRecency(a: KnownProject, b: KnownProject): number {
  const at = a.lastSeen !== undefined ? Date.parse(a.lastSeen) : 0;
  const bt = b.lastSeen !== undefined ? Date.parse(b.lastSeen) : 0;
  if (at !== bt) return bt - at;
  return a.root.localeCompare(b.root);
}

/**
 * Register GET /api/known-projects. Suggests project roots seen in `~/.claude`
 * that EXIST on disk and are NOT already registered instances, for the add flow.
 * Local-only, bounded, content-free (see the module header).
 */
export function registerKnownProjectsRoute(app: Hono, config: KnownProjectsConfig): void {
  const registry = config.registry;
  const home = config.home ?? path.join(os.homedir(), '.claude');
  const now = config.now ?? (() => Date.now());
  const cap = config.sessionCap ?? DEFAULT_KNOWN_SESSION_CAP;
  const ttlMs = config.ttlMs ?? DEFAULT_KNOWN_TTL_MS;
  const cache = new KnownProjectsCache(home, cap, ttlMs, config.resolveRoot ?? realpathResolver);

  app.get('/api/known-projects', async (c) => {
    const { candidates, sessionsTotal, capped } = await cache.load(now());
    // Filter FRESH each request so a just-added instance drops out immediately.
    const registered = new Set(registry.list().map((i) => i.root));
    const projects: KnownProject[] = candidates
      .filter((cand) => !registered.has(cand.root))
      .map((cand) => ({
        root: cand.root,
        sessionCount: cand.sessionCount,
        ...(cand.lastSeenMs !== undefined
          ? { lastSeen: new Date(cand.lastSeenMs).toISOString() }
          : {}),
      }))
      .sort(byRecency);
    const body: KnownProjectsResponse = { projects, sessionsTotal, capped };
    return c.json(body);
  });
}
