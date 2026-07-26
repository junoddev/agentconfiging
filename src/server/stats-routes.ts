/**
 * stats-routes — the read-only DASHBOARD data surface (SPEC §5 row 1 / E7, bead
 * agentconfig-7yb.2). Registered under `/api`, so every route INHERITS the
 * hardened app's gates (Host allowlist, bearer token, same-origin/CSRF). This
 * module adds no gate of its own.
 *
 * LOCAL-ONLY read: the dashboard stats are derived from THIS machine's runtime
 * history under `~/.claude` (session logs + `history.jsonl`), read through the
 * committed `claudeAdapter` (src/core/history). The server binds loopback only,
 * so this on-disk history is never exposed off-machine.
 *
 * CONTENT-FREE responses: `computeStats`/`evaluateAchievements` are pure over the
 * typed models and count messages / reason about timestamps only — they never
 * read message CONTENT. GET /api/stats returns the aggregate `DashboardStats`
 * plus achievement METADATA (id/name/description/category — never the criterion
 * predicate). GET /api/sessions returns per-session METADATA only (id, title,
 * cwd, timestamps, message COUNT, runtime) — never any message body. Session
 * titles/cwds are adversarial log text; callers render them as text nodes.
 *
 * BOUNDED work: a huge `~/.claude` must never hang the server. Discovery lists
 * every session file (cheap), but only the {@link DEFAULT_SESSION_CAP} MOST
 * RECENT files (by mtime) are fully read + parsed. Totals therefore reflect the
 * most-recent window, not all-time; the cap is reported in the response
 * (`sessionsScanned` / `sessionsTotal` / `capped`). The expensive disk read is
 * cached with a short TTL and shared by both routes; {@link StatsCache.invalidate}
 * is the seam a file watcher can call to force a recompute.
 */

import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import {
  ACHIEVEMENTS,
  claudeAdapter,
  computeStats,
  evaluateAchievements,
  type Achievement,
  type DashboardStats,
  type PromptHistory,
  type Session,
} from '../core/index.js';

/** Most-recent session files fully read + parsed per load (bounds the work). */
export const DEFAULT_SESSION_CAP = 400;
/** How long a disk read is reused before a fresh scan (ms). */
export const DEFAULT_TTL_MS = 30_000;

export interface StatsRoutesConfig {
  /**
   * The claude runtime home dir (the directory that holds `projects/` and
   * `history.jsonl`). Defaults to `~/.claude`. Injectable so tests point it at a
   * temp fixture and exercise the REAL adapter with no touch to the user's home.
   */
  home?: string;
  /** Clock anchor for streaks / the heatmap window. Defaults to `Date.now`. */
  now?: () => number;
  /** Most-recent session files read per load. Defaults to {@link DEFAULT_SESSION_CAP}. */
  sessionCap?: number;
  /** Cache TTL in ms. Defaults to {@link DEFAULT_TTL_MS}. */
  ttlMs?: number;
}

// ── Wire types (mirrored in web/src/api/types.ts) ─────────────────────────────

/** Achievement METADATA as served — the catalog entry minus its criterion. */
export interface AchievementMeta {
  id: string;
  name: string;
  description: string;
  category: Achievement['category'];
}

/** Unlocked / locked partition of the catalog, metadata only. */
export interface AchievementsPayload {
  unlocked: AchievementMeta[];
  locked: AchievementMeta[];
}

/** GET /api/stats payload — aggregate stats + achievement metadata only. */
export interface StatsResponse {
  stats: DashboardStats;
  achievements: AchievementsPayload;
  /** Distinct session files fully read this scan (≤ the cap). */
  sessionsScanned: number;
  /** Session files discovered on disk before the cap was applied. */
  sessionsTotal: number;
  /** True when discovery found more files than the cap (totals are windowed). */
  capped: boolean;
}

/** One session's METADATA (no message content). Titles/cwds are text only. */
export interface SessionSummary {
  id: string;
  runtime: string;
  /** ai-title / summary line when present, else '' (opaque log text). */
  title: string;
  /** First in-file cwd when present, else '' (opaque log text). */
  cwd: string;
  /** Earliest / latest parseable message timestamp (ISO), when present. */
  startedAt?: string;
  endedAt?: string;
  /** Messages in the session (a COUNT, never the bodies). */
  messageCount: number;
  /** end − start in ms when both timestamps parse, else undefined. */
  runtimeMs?: number;
}

/** GET /api/sessions payload — a bounded, content-free session list. */
export interface SessionsResponse {
  sessions: SessionSummary[];
  sessionsTotal: number;
  capped: boolean;
}

// ── Shared bounded loader (7yb.3 session-detail extends this) ──────────────────

/** The parsed history read from disk, shared by /api/stats and /api/sessions. */
export interface LoadedHistory {
  sessions: Session[];
  promptHistory: PromptHistory;
  /** Session files discovered before the cap. */
  sessionsTotal: number;
  /** True when discovery exceeded the cap. */
  capped: boolean;
}

const EMPTY_PROMPT_HISTORY: PromptHistory = {
  entries: [],
  diagnostics: {
    totalLines: 0,
    skipped: 0,
    malformed: 0,
    ignored: 0,
    unknownTypes: [],
    overflowCount: 0,
    rejectedSpillPaths: 0,
  },
};

/**
 * Bounded, TTL-cached reader for the runtime history under `home`. Discovery
 * lists every session file; only the `cap` most-recent (by mtime) are read.
 * Resilient: a missing `~/.claude`, unreadable files, or an absent prompt
 * history all degrade to empty data (zeroed stats), never an error.
 */
export class StatsCache {
  readonly #home: string;
  readonly #cap: number;
  readonly #ttlMs: number;
  #entry: { at: number; value: LoadedHistory } | undefined;
  #inflight: Promise<LoadedHistory> | undefined;

  constructor(home: string, cap: number, ttlMs: number) {
    this.#home = home;
    this.#cap = cap;
    this.#ttlMs = ttlMs;
  }

  /** Drop the cached read — the seam a watcher calls to force a recompute. */
  invalidate(): void {
    this.#entry = undefined;
  }

  /** The parsed history, from cache when fresh, else a fresh bounded read. */
  load(nowMs: number): Promise<LoadedHistory> {
    if (this.#entry && nowMs - this.#entry.at < this.#ttlMs) {
      return Promise.resolve(this.#entry.value);
    }
    // Coalesce concurrent misses so a burst of requests triggers one disk read.
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

  async #read(): Promise<LoadedHistory> {
    const refs = await claudeAdapter.discoverSessions(this.#home);
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

    const sessions: Session[] = [];
    for (const { path: filePath } of selected) {
      try {
        sessions.push(await claudeAdapter.readSession(filePath));
      } catch {
        // A file that vanished / is unreadable must not abort the whole load.
      }
    }

    let promptHistory = EMPTY_PROMPT_HISTORY;
    try {
      promptHistory = (await claudeAdapter.readPromptHistory?.(this.#home)) ?? EMPTY_PROMPT_HISTORY;
    } catch {
      // No / unreadable history.jsonl — prompt counts stay zero.
    }

    return { sessions, promptHistory, sessionsTotal, capped };
  }
}

function toMeta(a: Achievement): AchievementMeta {
  return { id: a.id, name: a.name, description: a.description, category: a.category };
}

/** ISO → epoch-ms, or undefined when unparseable. */
function isoMs(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Reduce a parsed session to its content-free summary. */
export function sessionSummary(session: Session): SessionSummary {
  const startMs = isoMs(session.startedAt);
  const endMs = isoMs(session.endedAt);
  const summary: SessionSummary = {
    id: session.sessionId ?? path.basename(session.filePath, '.jsonl'),
    runtime: session.runtime,
    title: session.title ?? session.summary ?? '',
    cwd: session.cwd ?? '',
    messageCount: session.messages.length,
  };
  if (session.startedAt !== undefined) summary.startedAt = session.startedAt;
  if (session.endedAt !== undefined) summary.endedAt = session.endedAt;
  if (startMs !== undefined && endMs !== undefined && endMs >= startMs) {
    summary.runtimeMs = endMs - startMs;
  }
  return summary;
}

/** Session list ordering: most-recent activity first, then by id for stability. */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  const at = isoMs(a.endedAt ?? a.startedAt) ?? 0;
  const bt = isoMs(b.endedAt ?? b.startedAt) ?? 0;
  if (at !== bt) return bt - at;
  return a.id.localeCompare(b.id);
}

/**
 * Register the read-only dashboard routes. Both share one {@link StatsCache}, so
 * a single bounded disk read backs a page's stats + session-list fetch.
 */
export function registerStatsRoutes(app: Hono, config: StatsRoutesConfig = {}): void {
  const home = config.home ?? path.join(os.homedir(), '.claude');
  const now = config.now ?? (() => Date.now());
  const cap = config.sessionCap ?? DEFAULT_SESSION_CAP;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new StatsCache(home, cap, ttlMs);

  // GET /api/stats — aggregate dashboard stats + achievement metadata. Local-
  // only (~/.claude), bounded (session cap), content-free (aggregates only).
  app.get('/api/stats', async (c) => {
    const nowMs = now();
    const { sessions, promptHistory, sessionsTotal, capped } = await cache.load(nowMs);
    const stats = computeStats(sessions, promptHistory, { now: nowMs });
    const evaluation = evaluateAchievements(stats);
    const body: StatsResponse = {
      stats,
      achievements: {
        unlocked: evaluation.unlocked.map(toMeta),
        locked: evaluation.locked.map(toMeta),
      },
      sessionsScanned: sessions.length,
      sessionsTotal,
      capped,
    };
    return c.json(body);
  });

  // GET /api/sessions — a bounded, content-free session list (metadata only).
  // Session DETAIL (message replay) is bead 7yb.3, which extends this module's
  // shared cache; the list here carries no message bodies.
  app.get('/api/sessions', async (c) => {
    const { sessions, sessionsTotal, capped } = await cache.load(now());
    const list = sessions.map(sessionSummary).sort(byRecency);
    const body: SessionsResponse = { sessions: list, sessionsTotal, capped };
    return c.json(body);
  });
}

/** The full achievement catalog as metadata (id/name/description/category). */
export const ACHIEVEMENT_CATALOG: AchievementMeta[] = ACHIEVEMENTS.map(toMeta);
