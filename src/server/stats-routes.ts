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

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import {
  ACHIEVEMENTS,
  claudeAdapter,
  computeSessionUsage,
  computeStats,
  evaluateAchievements,
  redact,
  type Achievement,
  type ContentBlock,
  type DashboardStats,
  type PromptHistory,
  type RedactionSpan,
  type Session,
  type SessionMessage,
  type UsageSummary,
} from '../core/index.js';

/** Most-recent session files fully read + parsed per load (bounds the work). */
export const DEFAULT_SESSION_CAP = 400;
/** How long a disk read is reused before a fresh scan (ms). */
export const DEFAULT_TTL_MS = 30_000;
/**
 * LIVE detection window (ms): a session file whose mtime is within this many ms
 * of "now" is treated as actively-appended (growing) and flagged `live` so the
 * UI can give it the signal PULSE (SPEC §4.4). A simple mtime-recency flag is
 * the v1 signal — no watcher/WS push is required for it.
 */
export const DEFAULT_LIVE_WINDOW_MS = 60_000;
/** Messages returned per detail page when the caller gives no `limit`. */
export const DEFAULT_PAGE_SIZE = 200;
/** Hard ceiling on a detail page (bounds the wire payload for huge sessions). */
export const MAX_PAGE_SIZE = 500;
/** Bounds on the user-authored tag set stored per session. */
export const MAX_TAGS = 32;
export const MAX_TAG_LENGTH = 64;

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
  /** Recency window that flags a session `live`. Defaults to {@link DEFAULT_LIVE_WINDOW_MS}. */
  liveWindowMs?: number;
  /** Messages per detail page when `limit` is omitted. Defaults to {@link DEFAULT_PAGE_SIZE}. */
  pageSize?: number;
  /**
   * Directory the user-authored session TAGS sidecar lives in. Defaults to an
   * XDG state dir (`$XDG_STATE_HOME/agentconfiging` or `~/.local/state/agentconfiging`).
   * Injectable so tests point it at a temp dir. The tags file is a single fixed
   * file inside this dir — session ids are only ever used as JSON object KEYS,
   * never spliced into a filesystem path.
   */
  stateDir?: string;
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
  /** True when the session file was appended within the live window (SPEC §4.4). */
  live: boolean;
  /** User-authored tags for this session (local sidecar; may be empty). */
  tags: string[];
  /** Token/cost usage metadata from assistant `message.usage` blocks. */
  usage: UsageSummary;
}

/** GET /api/sessions payload — a bounded, content-free session list. */
export interface SessionsResponse {
  sessions: SessionSummary[];
  sessionsTotal: number;
  capped: boolean;
}

// ── Session DETAIL (replay) wire types (7yb.3) ────────────────────────────────

/**
 * One content block of a replayed message, with all SECRET-BEARING string
 * content REDACTED server-side (SPEC §3): `text` never carries a raw secret and
 * `spans` locate each `[REDACTED:*]` mark for styling. The renderer treats every
 * field as a TEXT node — nothing here is interpreted.
 *
 * Kinds mirror {@link ContentBlock}. `tool_use` deliberately omits its `input`:
 * tool inputs are adversarial, potentially secret-bearing, and unbounded — only
 * the structural kind + tool `name` are surfaced. `persistedOutputPath` is a
 * REFERENCE to a spilled tool-result file (already shape-validated by the
 * reader) — it is surfaced as text and NEVER read/opened.
 */
export interface ReplayBlock {
  kind: ContentBlock['type'];
  /** Redacted text for text / thinking / tool_result blocks. */
  text?: string;
  /** `[REDACTED:*]` mark offsets over `text`. */
  spans?: RedactionSpan[];
  /** Tool name for a tool_use block (structural). */
  name?: string;
  /** Correlating id for a tool_result block. */
  toolUseId?: string;
  /** Spill-file reference for a tool_result — a pointer only, never read. */
  persistedOutputPath?: string;
  /** Raw block `type` for an unrecognized block. */
  blockType?: string;
}

/** One replayed message: structural fields + redacted content blocks. */
export interface ReplayMessage {
  role: SessionMessage['role'];
  /** Subagent (sidechain) traffic — rendered distinctly by the UI (SPEC §5). */
  isSidechain: boolean;
  /** Runtime-injected meta line (not user-typed). */
  isMeta: boolean;
  timestamp?: string;
  model?: string;
  uuid?: string;
  blocks: ReplayBlock[];
}

/**
 * GET /api/sessions/:id payload — ONE session's replay, PAGINATED. `messages` is
 * the requested window `[offset, offset+limit)`; `messageCount` is the session
 * total so the UI can page. All content is redacted before it crosses the wire.
 */
export interface SessionDetailResponse {
  id: string;
  runtime: string;
  title: string;
  cwd: string;
  startedAt?: string;
  endedAt?: string;
  /** Total messages in the session (not the page length). */
  messageCount: number;
  /** Window start actually served (clamped). */
  offset: number;
  /** Window size actually served (clamped to {@link MAX_PAGE_SIZE}). */
  limit: number;
  messages: ReplayMessage[];
  live: boolean;
  tags: string[];
  /** Token/cost usage metadata from assistant `message.usage` blocks. */
  usage: UsageSummary;
}

/** POST /api/sessions/:id/tags payload — the stored (sanitized) tag set. */
export interface SessionTagsResponse {
  id: string;
  tags: string[];
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
  /** filePath → file mtime (epoch ms) at read time — drives live detection. */
  mtimes: Map<string, number>;
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
    const mtimes = new Map<string, number>();
    for (const { path: filePath, mtimeMs } of selected) {
      try {
        sessions.push(await claudeAdapter.readSession(filePath));
        mtimes.set(filePath, mtimeMs);
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

    return { sessions, promptHistory, sessionsTotal, capped, mtimes };
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

/**
 * A session's stable id: the in-file sessionId when present, else the file's
 * basename. This is the ONLY handle detail/tags routes accept — a request for an
 * id absent from the loaded set is a 404, so a `../../` value can never be turned
 * into a file read (the path-validation discipline is "accept only ids from the
 * discovered set"). Ids are never spliced into a filesystem path.
 */
export function sessionIdOf(session: Session): string {
  return session.sessionId ?? path.basename(session.filePath, '.jsonl');
}

/** Reduce a parsed session to its content-free summary. */
export function sessionSummary(session: Session): SessionSummary {
  const startMs = isoMs(session.startedAt);
  const endMs = isoMs(session.endedAt);
  const summary: SessionSummary = {
    id: sessionIdOf(session),
    runtime: session.runtime,
    // Redact the ai-title (auto-generated from content — could echo a secret).
    title: redact(session.title ?? session.summary ?? '').text,
    cwd: session.cwd ?? '',
    messageCount: session.messages.length,
    live: false,
    tags: [],
    usage: computeSessionUsage(session),
  };
  if (session.startedAt !== undefined) summary.startedAt = session.startedAt;
  if (session.endedAt !== undefined) summary.endedAt = session.endedAt;
  if (startMs !== undefined && endMs !== undefined && endMs >= startMs) {
    summary.runtimeMs = endMs - startMs;
  }
  return summary;
}

/** True when a session file's mtime is within the live window of `nowMs`. */
export function isLive(mtimeMs: number | undefined, nowMs: number, windowMs: number): boolean {
  return mtimeMs !== undefined && nowMs - mtimeMs <= windowMs;
}

/**
 * Redact ONE content block for the wire. Every string that can carry a
 * user-pasted / tool-emitted secret (text, thinking, tool_result text) is run
 * through the hardened catalogue so a raw secret NEVER leaves the process. A
 * tool_use `input` is omitted entirely (adversarial + unbounded + secret-prone);
 * only the structural kind + tool name survive.
 */
export function redactBlock(block: ContentBlock): ReplayBlock {
  switch (block.type) {
    case 'text': {
      const { text, spans } = redact(block.text);
      return { kind: 'text', text, spans };
    }
    case 'thinking': {
      const { text, spans } = redact(block.thinking);
      return { kind: 'thinking', text, spans };
    }
    case 'tool_use': {
      const out: ReplayBlock = { kind: 'tool_use' };
      if (block.name !== undefined) out.name = block.name;
      return out;
    }
    case 'tool_result': {
      const { text, spans } = redact(block.text);
      const out: ReplayBlock = { kind: 'tool_result', text, spans };
      if (block.toolUseId !== undefined) out.toolUseId = block.toolUseId;
      if (block.persistedOutputPath !== undefined) {
        out.persistedOutputPath = block.persistedOutputPath;
      }
      return out;
    }
    default:
      return { kind: 'unknown', blockType: block.blockType };
  }
}

/** Map a parsed message to its redacted replay shape. */
export function toReplayMessage(message: SessionMessage): ReplayMessage {
  const out: ReplayMessage = {
    role: message.role,
    isSidechain: message.isSidechain,
    isMeta: message.isMeta,
    blocks: message.content.map(redactBlock),
  };
  if (message.timestamp !== undefined) out.timestamp = message.timestamp;
  if (message.model !== undefined) out.model = message.model;
  if (message.uuid !== undefined) out.uuid = message.uuid;
  return out;
}

/** Sanitize an untrusted tag list: strings only, trimmed, deduped, bounded. */
export function sanitizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim().slice(0, MAX_TAG_LENGTH);
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Parse & clamp the `offset` / `limit` page params (defaults + hard ceiling). */
function parsePage(c: Context, pageSize: number): { offset: number; limit: number } {
  const url = new URL(c.req.url);
  const rawOffset = Number(url.searchParams.get('offset'));
  const rawLimit = Number(url.searchParams.get('limit'));
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(Math.floor(rawOffset), Number.MAX_SAFE_INTEGER)
      : 0;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), MAX_PAGE_SIZE)
      : pageSize;
  return { offset, limit };
}

/** Default XDG-ish state dir for the tags sidecar. */
export function defaultStateDir(): string {
  const xdg = process.env['XDG_STATE_HOME'];
  const base = xdg && xdg.trim() !== '' ? xdg : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'agentconfiging');
}

/**
 * Local sidecar for user-authored session tags. Session logs are read-only, so
 * tags live in a single fixed JSON file under a server-controlled state dir
 * ({@link defaultStateDir}); the file maps sessionId → string[]. Session ids are
 * only ever JSON KEYS — never part of the file path — so there is no path-
 * traversal surface here. Reads are resilient (missing/malformed → empty).
 */
export class TagStore {
  readonly #file: string;

  constructor(stateDir: string) {
    this.#file = path.join(stateDir, 'session-tags.json');
  }

  async readAll(): Promise<Record<string, string[]>> {
    let raw: string;
    try {
      raw = await readFile(this.#file, 'utf8');
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const tags = sanitizeTags(value);
      if (tags.length > 0) out[key] = tags;
    }
    return out;
  }

  async get(id: string): Promise<string[]> {
    return (await this.readAll())[id] ?? [];
  }

  /** Replace the tag set for `id`; an empty set removes the entry. Returns it. */
  async set(id: string, tags: string[]): Promise<string[]> {
    const all = await this.readAll();
    const clean = sanitizeTags(tags);
    if (clean.length === 0) delete all[id];
    else all[id] = clean;
    await mkdir(path.dirname(this.#file), { recursive: true });
    await writeFile(this.#file, JSON.stringify(all), 'utf8');
    return clean;
  }
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
  const liveWindowMs = config.liveWindowMs ?? DEFAULT_LIVE_WINDOW_MS;
  const pageSize = config.pageSize ?? DEFAULT_PAGE_SIZE;
  const cache = new StatsCache(home, cap, ttlMs);
  const tagStore = new TagStore(config.stateDir ?? defaultStateDir());

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
  // Each row carries a `live` mtime-recency flag (SPEC §4.4) and its local tags;
  // message bodies live only in the DETAIL route below.
  app.get('/api/sessions', async (c) => {
    const nowMs = now();
    const { sessions, sessionsTotal, capped, mtimes } = await cache.load(nowMs);
    const tagMap = await tagStore.readAll();
    const list = sessions
      .map((session) => {
        const summary = sessionSummary(session);
        summary.live = isLive(mtimes.get(session.filePath), nowMs, liveWindowMs);
        summary.tags = tagMap[summary.id] ?? [];
        return summary;
      })
      .sort(byRecency);
    const body: SessionsResponse = { sessions: list, sessionsTotal, capped };
    return c.json(body);
  });

  // GET /api/sessions/:id — ONE session's replay, PAGINATED + REDACTED. The id
  // must name a session in the loaded set (path-validation: an arbitrary/`../../`
  // id matches nothing → 404, and is never turned into a file read). Every
  // secret-bearing string is redacted server-side before serialization.
  app.get('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const nowMs = now();
    const { sessions, mtimes } = await cache.load(nowMs);
    const session = sessions.find((s) => sessionIdOf(s) === id);
    if (!session) return c.json({ error: 'not found' }, 404);

    const { offset, limit } = parsePage(c, pageSize);
    const window = session.messages.slice(offset, offset + limit).map(toReplayMessage);
    const tags = await tagStore.get(id);
    const body: SessionDetailResponse = {
      id,
      runtime: session.runtime,
      // Redact the ai-title: it is auto-generated from conversation content and
      // could echo a pasted secret. cwd is a plain fs path (not secret-shaped).
      title: redact(session.title ?? session.summary ?? '').text,
      cwd: session.cwd ?? '',
      messageCount: session.messages.length,
      offset,
      limit,
      messages: window,
      live: isLive(mtimes.get(session.filePath), nowMs, liveWindowMs),
      tags,
      usage: computeSessionUsage(session),
    };
    if (session.startedAt !== undefined) body.startedAt = session.startedAt;
    if (session.endedAt !== undefined) body.endedAt = session.endedAt;
    return c.json(body);
  });

  // POST /api/sessions/:id/tags {tags} — replace the local tag set for one
  // session. State-changing, so it inherits the app's Origin/CSRF gate. The id
  // is validated against the loaded set (so tags never accrue for phantom ids);
  // tags are sanitized (strings, trimmed, deduped, bounded) before they are
  // written to the local sidecar.
  app.post('/api/sessions/:id/tags', async (c) => {
    const id = c.req.param('id');
    const { sessions } = await cache.load(now());
    if (!sessions.some((s) => sessionIdOf(s) === id)) return c.json({ error: 'not found' }, 404);

    let parsed: unknown;
    try {
      parsed = await c.req.json();
    } catch {
      return c.json({ error: 'bad request' }, 400);
    }
    const rawTags =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as { tags?: unknown }).tags
        : undefined;
    const tags = await tagStore.set(id, sanitizeTags(rawTags));
    const body: SessionTagsResponse = { id, tags };
    return c.json(body);
  });
}

/** The full achievement catalog as metadata (id/name/description/category). */
export const ACHIEVEMENT_CATALOG: AchievementMeta[] = ACHIEVEMENTS.map(toMeta);
