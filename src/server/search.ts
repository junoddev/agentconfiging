/**
 * search — full-text SESSION SEARCH over turns + tool results (SPEC §5 row 17 /
 * E7, bead agentconfig-7yb.4). Backs GET /api/search, POST /api/search/reindex,
 * GET /api/search/status (registered by ./search-routes under the hardened app's
 * gates). The index is a SQLite FTS5 database built from THIS machine's runtime
 * history under `~/.claude`, read through the committed `claudeAdapter` (the same
 * sessions the dashboard/replay routes read).
 *
 * ── THE NATIVE-MODULE DISCIPLINE (the point of this bead) ─────────────────────
 * The core `npx` path must NEVER require a native module (docs/EXECUTION.md hard
 * rule). `better-sqlite3` is therefore an OPTIONAL dependency and is loaded
 * LAZILY, AT SEARCH TIME, via {@link defaultSqliteLoader} — an `await import`
 * wrapped in try/catch. If the module is absent or failed to build, the loader
 * returns `null` and EVERY search operation degrades to a typed
 * `{ available:false, reason }` (a 200, never a 500/crash). The rest of the
 * server — every other route — keeps working, and a user who never opens search
 * never loads the module. The loader is injectable so tests pin BOTH paths
 * (present via a fake DB, absent via a null loader) with no real native build.
 *
 * The dynamic import uses a COMPUTED specifier + `@vite-ignore` so neither the
 * bundler (tsup/esbuild) nor the test runner (vite) tries to statically resolve
 * `better-sqlite3` at build/transform time — resolution happens only at runtime
 * on the install machine, where a missing module rejects and is caught.
 *
 * ── REDACTION (SPEC §3) ───────────────────────────────────────────────────────
 * The FTS index stores RAW session text — it lives under a server-controlled
 * state dir, is local-only, and is never served. But a search SNIPPET that
 * crosses the wire is run through the hardened redaction catalogue first: a
 * snippet showing a secret is a leak, so results carry `[REDACTED:*]` marks +
 * span offsets exactly like session replay. Callers render snippets as TEXT
 * nodes only.
 *
 * ── QUERY SAFETY ──────────────────────────────────────────────────────────────
 * The user's query is UNTRUSTED. It is (a) bound as a PARAMETER to `MATCH ?`
 * (never string-concatenated into SQL — no SQL injection) and (b) reduced by
 * {@link sanitizeFtsMatch} to a guaranteed-valid FTS5 expression of quoted word
 * tokens, so hostile FTS5 syntax can neither inject nor throw a syntax error.
 *
 * ── EMBEDDINGS (opt-in, stubbed) ──────────────────────────────────────────────
 * Semantic/embeddings search is behind an OPT-IN flag ({@link SearchIndex}
 * `embeddings`). v1 ships the flag + a clear "not enabled / not implemented"
 * response; it adds NO embeddings dependency and calls no external service.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RedactionSpan, Session } from '../core/index.js';
import { redact } from '../core/index.js';
import { sessionIdOf, type LoadedHistory } from './stats-routes.js';

// ── The optional native module, typed to the minimal surface we use ───────────

/** The subset of better-sqlite3's `Statement` this module calls. */
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
/** The subset of better-sqlite3's `Database` this module calls. */
export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
  close(): unknown;
}
/** `new Database(filename)` — better-sqlite3's default export. */
export type SqliteDatabaseCtor = new (filename: string) => SqliteDatabase;
/**
 * Loads the optional `better-sqlite3` constructor, or `null` when it cannot be
 * loaded (not installed / native build failed). Injectable for tests.
 */
export type SqliteLoader = () => Promise<SqliteDatabaseCtor | null>;

/**
 * The production loader: a lazy, guarded dynamic import. A COMPUTED specifier +
 * `@vite-ignore` keeps the bundler/test-runner from statically resolving the
 * optional module; a rejected import (module absent) is caught → `null`.
 */
export const defaultSqliteLoader: SqliteLoader = async () => {
  try {
    const spec = ['better', 'sqlite3'].join('-');
    const mod = (await import(/* @vite-ignore */ spec)) as { default?: SqliteDatabaseCtor };
    return mod.default ?? null;
  } catch {
    return null;
  }
};

// ── Reasons + bounds ──────────────────────────────────────────────────────────

/** Served when the optional native module cannot be loaded. */
export const REASON_NO_MODULE =
  'search requires the optional better-sqlite3 module (not installed)';
/** Served when the module loads but the SQLite build lacks FTS5 / the index fails to open. */
export const REASON_NO_INDEX = 'search index unavailable (SQLite FTS5 support missing)';
/** Served for a semantic query when the embeddings flag is off. */
export const REASON_SEMANTIC_DISABLED = 'semantic search is not enabled (opt-in flag off)';
/** Served for a semantic query when the flag is on but the model is not wired up (v1 stub). */
export const REASON_SEMANTIC_STUB = 'semantic search is enabled but not yet implemented';

/** Default cap on returned hits (bounds the wire payload). */
export const DEFAULT_MAX_RESULTS = 50;
/** Hard ceiling on returned hits regardless of the requested limit. */
export const MAX_RESULTS_CEILING = 200;
/** Most query terms honored (bounds the MATCH expression). */
export const MAX_QUERY_TERMS = 16;

export type SearchMode = 'fts' | 'semantic';

// ── Wire-ish shapes (mirrored in web/src/api/types.ts) ────────────────────────

/** One indexable row: a message reduced to its searchable text. */
export interface IndexRow {
  sessionId: string;
  messageIndex: number;
  role: string;
  text: string;
  /** ISO timestamp or '' when the message had none. */
  timestamp: string;
}

/** One search hit — snippet already REDACTED, spans over the snippet. */
export interface SearchHit {
  sessionId: string;
  messageIndex: number;
  role: string;
  /** Redacted match-context snippet (text node only). */
  snippet: string;
  /** `[REDACTED:*]` mark offsets over `snippet`. */
  spans: RedactionSpan[];
  timestamp?: string;
}

/** Sessions/messages currently in the index. */
export interface Coverage {
  sessions: number;
  messages: number;
}

export type SearchResult =
  | { available: false; reason: string }
  | {
      available: true;
      mode: SearchMode;
      query: string;
      results: SearchHit[];
      truncated: boolean;
      /** Present only for a semantic query — the opt-in flag state + reason. */
      semantic?: { enabled: boolean; reason: string };
    };

export type ReindexResult =
  | { available: false; reason: string }
  | { available: true; indexed: Coverage; total: number; lastIndexedAt: string };

export type StatusResult =
  | { available: false; reason: string; embeddings: { enabled: boolean } }
  | {
      available: true;
      indexed: Coverage;
      total: number;
      lastIndexedAt?: string;
      embeddings: { enabled: boolean };
    };

// ── Pure helpers (DB-free, directly unit-testable) ────────────────────────────

/** Join a message's searchable content: text / thinking / tool_result text +
 *  the tool NAME of a tool_use (its input is adversarial + unbounded — omitted). */
export function messageSearchText(message: Session['messages'][number]): string {
  const parts: string[] = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text);
        break;
      case 'thinking':
        parts.push(block.thinking);
        break;
      case 'tool_result':
        parts.push(block.text);
        break;
      case 'tool_use':
        if (block.name !== undefined && block.name !== '') parts.push(block.name);
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
}

/** Reduce a session to its indexable rows (skips content-free messages). */
export function sessionRows(session: Session, id: string): IndexRow[] {
  const rows: IndexRow[] = [];
  session.messages.forEach((message, messageIndex) => {
    const text = messageSearchText(message);
    if (text.trim() === '') return;
    rows.push({
      sessionId: id,
      messageIndex,
      role: message.role,
      text,
      timestamp: message.timestamp ?? '',
    });
  });
  return rows;
}

/**
 * Reduce an UNTRUSTED user query to a guaranteed-valid FTS5 MATCH expression:
 * word tokens only (Unicode letters/digits/underscore), each double-quoted (with
 * any quote doubled — defensive; word tokens hold none) and prefix-flagged, ANDed
 * by space. The output contains no FTS5 operators, so hostile syntax can neither
 * throw a query error nor change the query's meaning. Bound as a PARAMETER at the
 * call site, so it is also injection-proof. Empty/operator-only input → '' (no query).
 */
export function sanitizeFtsMatch(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return '';
  return tokens
    .slice(0, MAX_QUERY_TERMS)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(' ');
}

/** Clamp a requested result limit to `[1, MAX_RESULTS_CEILING]`, defaulting sanely. */
export function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_RESULTS_CEILING);
}

/** Raw snippet row from the FTS query, before redaction. */
interface RawHit {
  sessionId: string;
  messageIndex: number;
  role: string;
  snip: string;
  timestamp: string;
}

/** Redact one raw hit's snippet server-side; a raw secret never crosses the wire. */
function redactHit(row: RawHit): SearchHit {
  const { text, spans } = redact(row.snip ?? '');
  const hit: SearchHit = {
    sessionId: String(row.sessionId ?? ''),
    messageIndex: Number(row.messageIndex ?? 0),
    role: String(row.role ?? ''),
    snippet: text,
    spans,
  };
  if (row.timestamp !== undefined && row.timestamp !== '') hit.timestamp = String(row.timestamp);
  return hit;
}

// ── The index schema ──────────────────────────────────────────────────────────

const SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS turns USING fts5(
  session_id UNINDEXED,
  message_index UNINDEXED,
  role UNINDEXED,
  text,
  timestamp UNINDEXED
);
CREATE TABLE IF NOT EXISTS indexed_files(session_id TEXT PRIMARY KEY, mtime REAL);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
`;

export interface SearchIndexConfig {
  /** Absolute path to the FTS index db file (under a server-controlled state dir). */
  dbPath: string;
  /** Loads the parsed history to index (shared bounded/cached reader). */
  load: (nowMs: number) => Promise<LoadedHistory>;
  /** Optional loader for the native module. Defaults to {@link defaultSqliteLoader}. */
  loader?: SqliteLoader;
  /** Opt-in embeddings/semantic flag. Default false. */
  embeddings?: boolean;
  /** Default max hits per query. Defaults to {@link DEFAULT_MAX_RESULTS}. */
  maxResults?: number;
}

/**
 * The FTS5 session index. Every method opens the db lazily via the injectable
 * loader and CLOSES it before returning; if the loader yields no constructor the
 * method degrades to an unavailable result. Nothing here throws for a missing
 * module — that is the whole contract.
 */
export class SearchIndex {
  readonly #dbPath: string;
  readonly #load: (nowMs: number) => Promise<LoadedHistory>;
  readonly #loader: SqliteLoader;
  readonly #embeddings: boolean;
  readonly #maxResults: number;

  constructor(config: SearchIndexConfig) {
    this.#dbPath = config.dbPath;
    this.#load = config.load;
    this.#loader = config.loader ?? defaultSqliteLoader;
    this.#embeddings = config.embeddings ?? false;
    this.#maxResults = config.maxResults ?? DEFAULT_MAX_RESULTS;
  }

  get embeddingsEnabled(): boolean {
    return this.#embeddings;
  }

  /** Open + migrate the index, or a reason string when it is unavailable. */
  async #open(): Promise<{ db: SqliteDatabase } | { error: string }> {
    let Ctor: SqliteDatabaseCtor | null;
    try {
      Ctor = await this.#loader();
    } catch {
      Ctor = null;
    }
    if (!Ctor) return { error: REASON_NO_MODULE };
    try {
      await mkdir(path.dirname(this.#dbPath), { recursive: true });
      const db = new Ctor(this.#dbPath);
      db.exec(SCHEMA); // FTS5 missing → throws here → degrade
      return { db };
    } catch {
      return { error: REASON_NO_INDEX };
    }
  }

  #coverage(db: SqliteDatabase): Coverage {
    const files = db.prepare('SELECT COUNT(*) AS n FROM indexed_files').get() as { n?: number };
    const turns = db.prepare('SELECT COUNT(*) AS n FROM turns').get() as { n?: number };
    return { sessions: Number(files?.n ?? 0), messages: Number(turns?.n ?? 0) };
  }

  #lastIndexedAt(db: SqliteDatabase): string | undefined {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'lastIndexedAt'").get() as
      { value?: string } | undefined;
    return row?.value;
  }

  /**
   * (Re)build the index. INCREMENTAL by session-file mtime: unchanged sessions
   * are skipped, changed/new sessions have their rows replaced, and sessions no
   * longer on disk are pruned. Whole pass runs in one transaction.
   */
  async reindex(nowMs: number): Promise<ReindexResult> {
    const opened = await this.#open();
    if ('error' in opened) return { available: false, reason: opened.error };
    const db = opened.db;
    try {
      const { sessions, sessionsTotal, mtimes } = await this.#load(nowMs);

      const existing = new Map<string, number>();
      for (const row of db.prepare('SELECT session_id AS id, mtime FROM indexed_files').all() as {
        id: string;
        mtime: number;
      }[]) {
        existing.set(row.id, Number(row.mtime));
      }

      const insertTurn = db.prepare(
        'INSERT INTO turns(session_id, message_index, role, text, timestamp) VALUES (?, ?, ?, ?, ?)',
      );
      const deleteTurns = db.prepare('DELETE FROM turns WHERE session_id = ?');
      const upsertFile = db.prepare(
        'INSERT INTO indexed_files(session_id, mtime) VALUES (?, ?) ' +
          'ON CONFLICT(session_id) DO UPDATE SET mtime = excluded.mtime',
      );
      const deleteFile = db.prepare('DELETE FROM indexed_files WHERE session_id = ?');

      const currentIds = new Set<string>();
      db.exec('BEGIN');
      try {
        for (const session of sessions) {
          const id = sessionIdOf(session);
          currentIds.add(id);
          const mtime = mtimes.get(session.filePath) ?? 0;
          if (existing.has(id) && existing.get(id) === mtime) continue; // unchanged
          deleteTurns.run(id);
          for (const row of sessionRows(session, id)) {
            insertTurn.run(row.sessionId, row.messageIndex, row.role, row.text, row.timestamp);
          }
          upsertFile.run(id, mtime);
        }
        for (const id of existing.keys()) {
          if (!currentIds.has(id)) {
            deleteTurns.run(id);
            deleteFile.run(id);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      const lastIndexedAt = new Date(nowMs).toISOString();
      db.prepare(
        "INSERT INTO meta(key, value) VALUES ('lastIndexedAt', ?) " +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run(lastIndexedAt);

      return {
        available: true,
        indexed: this.#coverage(db),
        total: sessionsTotal,
        lastIndexedAt,
      };
    } finally {
      db.close();
    }
  }

  /** Run a search. FTS mode queries the index; semantic mode returns the opt-in stub. */
  async search(rawQuery: string, mode: SearchMode, limit: number): Promise<SearchResult> {
    const query = typeof rawQuery === 'string' ? rawQuery : '';

    if (mode === 'semantic') {
      // The opt-in flag lives independent of the native module: report it either
      // way, and never actually run an embeddings model (none is wired in v1).
      return {
        available: true,
        mode: 'semantic',
        query,
        results: [],
        truncated: false,
        semantic: {
          enabled: this.#embeddings,
          reason: this.#embeddings ? REASON_SEMANTIC_STUB : REASON_SEMANTIC_DISABLED,
        },
      };
    }

    const match = sanitizeFtsMatch(query);
    const opened = await this.#open();
    if ('error' in opened) return { available: false, reason: opened.error };
    const db = opened.db;
    try {
      if (match === '') {
        return { available: true, mode: 'fts', query, results: [], truncated: false };
      }
      const cap = Math.min(limit, MAX_RESULTS_CEILING);
      // Query is BOUND (`MATCH ?`) — never concatenated. Fetch cap+1 to detect truncation.
      const rows = db
        .prepare(
          'SELECT session_id AS sessionId, message_index AS messageIndex, role, ' +
            "snippet(turns, 3, '', '', '…', 12) AS snip, timestamp " +
            'FROM turns WHERE turns MATCH ? ORDER BY rank LIMIT ?',
        )
        .all(match, cap + 1) as RawHit[];
      const truncated = rows.length > cap;
      const results = rows.slice(0, cap).map(redactHit);
      return { available: true, mode: 'fts', query, results, truncated };
    } finally {
      db.close();
    }
  }

  /** Index availability + coverage vs. total-on-disk + embeddings flag. */
  async status(nowMs: number): Promise<StatusResult> {
    const embeddings = { enabled: this.#embeddings };
    const opened = await this.#open();
    if ('error' in opened) return { available: false, reason: opened.error, embeddings };
    const db = opened.db;
    try {
      const indexed = this.#coverage(db);
      const lastIndexedAt = this.#lastIndexedAt(db);
      let total = 0;
      try {
        total = (await this.#load(nowMs)).sessionsTotal;
      } catch {
        total = 0;
      }
      const out: StatusResult = { available: true, indexed, total, embeddings };
      if (lastIndexedAt !== undefined) out.lastIndexedAt = lastIndexedAt;
      return out;
    } finally {
      db.close();
    }
  }

  /** Default max hits for a query (used by the route to clamp `limit`). */
  get maxResults(): number {
    return this.#maxResults;
  }
}
