/**
 * search-routes — the SESSION SEARCH surface (SPEC §5 row 17 / E7, bead
 * agentconfig-7yb.4). Registered under `/api`, so every route INHERITS the
 * hardened app's gates (Host allowlist, bearer token, same-origin/CSRF); this
 * module adds no gate of its own.
 *
 * GRACEFUL DEGRADATION: the search index depends on the OPTIONAL, lazily-loaded
 * `better-sqlite3` native module (see ./search.ts). When it cannot load, every
 * route answers with a typed `{ available:false, reason }` at HTTP 200 — never a
 * 500, never a crash — and the rest of the server keeps working. The module is
 * only touched when a search route is actually hit.
 *
 * LOCAL-ONLY + BOUNDED + REDACTED: sessions come from THIS machine's `~/.claude`
 * history via the same bounded, TTL-cached {@link StatsCache} the dashboard
 * routes use. Result snippets are REDACTED server-side (SPEC §3) before
 * they cross the wire; the raw index lives under a server-controlled state dir and
 * is never served. The query is bound as a parameter and sanitized for FTS5.
 */

import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import {
  DEFAULT_SESSION_CAP,
  DEFAULT_TTL_MS,
  StatsCache,
  defaultStateDir,
  type StatsRoutesConfig,
} from './stats-routes.js';
import { SearchIndex, clampLimit, type SearchMode, type SqliteLoader } from './search.js';

export interface SearchRoutesConfig extends StatsRoutesConfig {
  /** Injectable native-module loader (tests pin present/absent). */
  loader?: SqliteLoader;
  /** Opt-in embeddings/semantic flag (default off). */
  embeddings?: boolean;
  /** Directory the FTS index db lives in. Defaults to `<stateDir>/search`. */
  indexDir?: string;
  /** Default max hits per query. */
  maxResults?: number;
}

/** Parse the `mode` query param — only the two known modes; anything else → fts. */
function parseMode(raw: string | null): SearchMode {
  return raw === 'semantic' ? 'semantic' : 'fts';
}

/**
 * Register the session-search routes. Uses its own {@link StatsCache} over the
 * same `~/.claude` home + cap as the dashboard routes, and a {@link SearchIndex}
 * behind the lazy-optional native module.
 */
export function registerSearchRoutes(app: Hono, config: SearchRoutesConfig = {}): void {
  const home = config.home ?? path.join(os.homedir(), '.claude');
  const now = config.now ?? (() => Date.now());
  const cap = config.sessionCap ?? DEFAULT_SESSION_CAP;
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new StatsCache(home, cap, ttlMs);
  const indexDir = config.indexDir ?? path.join(config.stateDir ?? defaultStateDir(), 'search');

  const indexConfig: ConstructorParameters<typeof SearchIndex>[0] = {
    dbPath: path.join(indexDir, 'index.db'),
    load: (nowMs) => cache.load(nowMs),
    embeddings: config.embeddings ?? false,
  };
  if (config.loader !== undefined) indexConfig.loader = config.loader;
  if (config.maxResults !== undefined) indexConfig.maxResults = config.maxResults;
  const index = new SearchIndex(indexConfig);

  // GET /api/search?q=&mode=&limit= — FTS5 (or the semantic opt-in stub). Snippets
  // are redacted server-side; the query is sanitized + bound as a parameter. When
  // the optional module is unavailable → { available:false, reason } (a 200).
  app.get('/api/search', async (c) => {
    const url = new URL(c.req.url);
    const q = url.searchParams.get('q') ?? '';
    const mode = parseMode(url.searchParams.get('mode'));
    const limit = clampLimit(url.searchParams.get('limit'), index.maxResults);
    const result = await index.search(q, mode, limit);
    return c.json(result);
  });

  // POST /api/search/reindex — rebuild the index (incremental by mtime) + return
  // coverage. State-changing, so it inherits the app's Origin/CSRF gate. Degrades
  // to { available:false, reason } when the module is unavailable.
  app.post('/api/search/reindex', async (c) => {
    const result = await index.reindex(now());
    return c.json(result);
  });

  // GET /api/search/status — availability + coverage vs. total + embeddings flag.
  app.get('/api/search/status', async (c) => {
    const result = await index.status(now());
    return c.json(result);
  });
}
