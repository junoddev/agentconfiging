/**
 * Tests for SESSION SEARCH (bead 7yb.4). The load-bearing invariant is the
 * LAZY-OPTIONAL native-module discipline: with the `better-sqlite3` loader
 * yielding `null`, every search operation degrades to `{ available:false }` (a
 * 200) and the rest of the server keeps working — proven WITHOUT any real native
 * build. The "available" path is exercised against an INJECTED fake DB that
 * records the exact SQL + bound parameters, so reindex coverage, snippet
 * REDACTION, and FTS5 query PARAMETERIZATION are pinned at the application layer.
 * Pure query-sanitization is fuzzed for injection/syntax safety directly.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApp } from './app.js';
import { InstanceRegistry } from './registry.js';
import { registerSearchRoutes } from './search-routes.js';
import {
  SearchIndex,
  defaultSqliteLoader,
  messageSearchText,
  sanitizeFtsMatch,
  sessionRows,
  REASON_NO_MODULE,
  REASON_SEMANTIC_DISABLED,
  REASON_SEMANTIC_STUB,
  type SqliteDatabaseCtor,
  type SqliteLoader,
} from './search.js';
import type { LoadedHistory } from './index.js';
import type { Session } from '../core/index.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentconfig-search-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

/** A real AWS-style secret planted in a snippet; it MUST be redacted on the wire. */
const PLANTED_SECRET = 'AKIAIOSFODNN7EXAMPLE';

const EMPTY_PROMPTS: LoadedHistory['promptHistory'] = {
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

function fakeSession(id: string, filePath: string, texts: string[]): Session {
  return {
    runtime: 'claude',
    sessionId: id,
    filePath,
    cwds: [],
    messages: texts.map((t, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      isSidechain: false,
      isMeta: false,
      content: [{ type: 'text', text: t }],
      timestamp: new Date(NOW + i * 1000).toISOString(),
    })),
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
}

function loaded(sessions: Session[], total: number, mtimes: Map<string, number>): LoadedHistory {
  return { sessions, promptHistory: EMPTY_PROMPTS, sessionsTotal: total, capped: false, mtimes };
}

interface CannedRow {
  sessionId: string;
  messageIndex: number;
  role: string;
  snip: string;
  timestamp: string;
}

/**
 * A minimal in-memory stand-in for better-sqlite3 that HONORS the subset of the
 * API SearchIndex uses. It records every bound-parameter set for MATCH queries so
 * the test can prove the query travels as a parameter, and it counts inserted
 * rows so coverage is real.
 */
class FakeDb {
  turns: unknown[][] = [];
  files = new Map<string, number>();
  meta = new Map<string, string>();
  execLog: string[] = [];
  matchCalls: unknown[][] = [];
  constructor(public searchRows: CannedRow[] = []) {}

  exec(sql: string): unknown {
    this.execLog.push(sql.trim());
    return undefined;
  }

  prepare(sql: string) {
    const s = sql.trim();
    return {
      run: (...p: unknown[]) => {
        if (s.startsWith('INSERT INTO turns')) this.turns.push(p);
        else if (s.startsWith('DELETE FROM turns'))
          this.turns = this.turns.filter((r) => r[0] !== p[0]);
        else if (s.startsWith('INSERT INTO indexed_files'))
          this.files.set(String(p[0]), Number(p[1]));
        else if (s.startsWith('DELETE FROM indexed_files')) this.files.delete(String(p[0]));
        else if (s.startsWith('INSERT INTO meta')) this.meta.set('lastIndexedAt', String(p[0]));
        return {};
      },
      get: () => {
        if (s.includes('COUNT(*)') && s.includes('indexed_files')) return { n: this.files.size };
        if (s.includes('COUNT(*)') && s.includes('turns')) return { n: this.turns.length };
        if (s.includes("FROM meta WHERE key = 'lastIndexedAt'"))
          return this.meta.has('lastIndexedAt')
            ? { value: this.meta.get('lastIndexedAt') }
            : undefined;
        return undefined;
      },
      all: (...p: unknown[]) => {
        if (s.includes('FROM indexed_files'))
          return [...this.files.entries()].map(([id, mtime]) => ({ id, mtime }));
        if (s.includes('turns MATCH')) {
          this.matchCalls.push(p);
          return this.searchRows.slice(0, Number(p[1] ?? this.searchRows.length));
        }
        return [];
      },
    };
  }

  close(): unknown {
    return undefined;
  }
}

/** A loader whose constructor always returns the SAME FakeDb instance. */
function fakeLoader(db: FakeDb): SqliteLoader {
  const Ctor = function () {
    return db;
  };
  return async () => Ctor as unknown as SqliteDatabaseCtor;
}

const NULL_LOADER: SqliteLoader = async () => null;

function dbPath(name: string): string {
  return path.join(base, name, 'search', 'index.db');
}

// ── Pure query safety ─────────────────────────────────────────────────────────

describe('sanitizeFtsMatch', () => {
  it('reduces a plain query to prefix-flagged, quoted word tokens (implicit AND)', () => {
    expect(sanitizeFtsMatch('deploy the key')).toBe('"deploy"* "the"* "key"*');
  });

  it('is empty for operator-only / punctuation-only input (no query)', () => {
    expect(sanitizeFtsMatch('')).toBe('');
    expect(sanitizeFtsMatch('   ')).toBe('');
    expect(sanitizeFtsMatch('!!! "" *** ()')).toBe('');
  });

  it('neutralizes hostile FTS5 syntax + SQL-shaped input into safe tokens', () => {
    // A lone quote, boolean operators, column filters, NEAR, and a SQL-injection
    // attempt all become quoted word tokens — no operators survive.
    expect(sanitizeFtsMatch('foo" OR 1=1 --')).toBe('"foo"* "OR"* "1"* "1"*');
    expect(sanitizeFtsMatch('col:value')).toBe('"col"* "value"*');
    expect(sanitizeFtsMatch('a AND b NEAR(c)')).toBe('"a"* "AND"* "b"* "NEAR"* "c"*');
    expect(sanitizeFtsMatch("'; DROP TABLE turns; --")).toBe('"DROP"* "TABLE"* "turns"*');
  });

  it('bounds the number of terms', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(' ');
    const out = sanitizeFtsMatch(many);
    expect(out.split(' ').length).toBe(16);
  });

  it('ignores non-string input', () => {
    expect(sanitizeFtsMatch(undefined)).toBe('');
    expect(sanitizeFtsMatch(42)).toBe('');
  });
});

describe('sessionRows / messageSearchText', () => {
  it('extracts searchable text per message and skips empty ones', () => {
    const s: Session = {
      runtime: 'claude',
      sessionId: 'x',
      filePath: '/x',
      cwds: [],
      diagnostics: EMPTY_PROMPTS.diagnostics,
      messages: [
        {
          role: 'user',
          isSidechain: false,
          isMeta: false,
          content: [{ type: 'text', text: 'hello' }],
        },
        { role: 'assistant', isSidechain: false, isMeta: false, content: [] },
        {
          role: 'assistant',
          isSidechain: false,
          isMeta: false,
          content: [
            { type: 'thinking', thinking: 'ponder' },
            { type: 'tool_use', name: 'Bash', input: { secret: 'x' } },
            { type: 'tool_result', text: 'output', toolUseId: 't' },
          ],
        },
      ],
    };
    const rows = sessionRows(s, 'x');
    expect(rows.map((r) => r.messageIndex)).toEqual([0, 2]); // empty msg skipped
    // tool_use contributes only its NAME, never its input.
    expect(rows[1]?.text).toContain('Bash');
    expect(rows[1]?.text).not.toContain('secret');
  });

  it('messageSearchText omits tool_use input entirely', () => {
    const text = messageSearchText({
      role: 'assistant',
      isSidechain: false,
      isMeta: false,
      content: [{ type: 'tool_use', name: 'Read', input: { path: '/etc/passwd' } }],
    });
    expect(text).toBe('Read');
  });
});

// ── The lazy-optional native-module discipline (the KEY path) ─────────────────

describe('graceful degradation when better-sqlite3 is unavailable', () => {
  it('search / reindex / status all report available:false without throwing', async () => {
    const index = new SearchIndex({
      dbPath: dbPath('nomodule'),
      load: async () => loaded([], 0, new Map()),
      loader: NULL_LOADER,
    });
    const s = await index.search('anything', 'fts', 50);
    expect(s).toEqual({ available: false, reason: REASON_NO_MODULE });

    const r = await index.reindex(NOW);
    expect(r).toEqual({ available: false, reason: REASON_NO_MODULE });

    const st = await index.status(NOW);
    expect(st).toEqual({
      available: false,
      reason: REASON_NO_MODULE,
      embeddings: { enabled: false },
    });
  });

  it('the default loader never throws and yields null-or-a-ctor', async () => {
    const ctor = await defaultSqliteLoader();
    // Absent in this env → null; if a machine HAS it, a constructor. Either is fine.
    expect(ctor === null || typeof ctor === 'function').toBe(true);
  });
});

// ── The available path, pinned against a fake DB ──────────────────────────────

describe('search index over an injected fake DB', () => {
  it('reindex inserts parameterized rows and reports real coverage', async () => {
    const db = new FakeDb();
    const s1 = fakeSession('s1', '/h/s1.jsonl', ['alpha one', 'alpha two']);
    const s2 = fakeSession('s2', '/h/s2.jsonl', ['beta one', 'beta two']);
    const mtimes = new Map([
      ['/h/s1.jsonl', 111],
      ['/h/s2.jsonl', 222],
    ]);
    const index = new SearchIndex({
      dbPath: dbPath('reindex'),
      load: async () => loaded([s1, s2], 7, mtimes),
      loader: fakeLoader(db),
    });

    const r = await index.reindex(NOW);
    expect(r).toMatchObject({ available: true, indexed: { sessions: 2, messages: 4 }, total: 7 });
    // Rows were inserted with 5 bound params each (never string-concatenated).
    expect(db.turns).toHaveLength(4);
    expect(db.turns[0]).toHaveLength(5);
    expect(db.execLog).toContain('BEGIN');
    expect(db.execLog).toContain('COMMIT');
  });

  it('reindex is incremental: unchanged files are skipped, removed files pruned', async () => {
    const db = new FakeDb();
    const s1 = fakeSession('s1', '/h/s1.jsonl', ['alpha one', 'alpha two']);
    const s2 = fakeSession('s2', '/h/s2.jsonl', ['beta one', 'beta two']);
    let sessions = [s1, s2];
    const mtimes = new Map([
      ['/h/s1.jsonl', 111],
      ['/h/s2.jsonl', 222],
    ]);
    const index = new SearchIndex({
      dbPath: dbPath('incremental'),
      load: async () => loaded(sessions, sessions.length, mtimes),
      loader: fakeLoader(db),
    });

    await index.reindex(NOW);
    expect(db.turns).toHaveLength(4);

    // Second pass, nothing changed → no re-insert (count stable), both kept.
    await index.reindex(NOW);
    expect(db.turns).toHaveLength(4);
    expect(db.files.size).toBe(2);

    // Drop s2 from the load → its rows are pruned.
    sessions = [s1];
    await index.reindex(NOW);
    expect(db.files.size).toBe(1);
    expect(db.turns.every((r) => r[0] === 's1')).toBe(true);
  });

  it('search returns REDACTED snippets and binds the SANITIZED query as a parameter', async () => {
    const db = new FakeDb([
      {
        sessionId: 's1',
        messageIndex: 3,
        role: 'assistant',
        snip: `deploy with key ${PLANTED_SECRET} now`,
        timestamp: '2026-07-26T00:00:00.000Z',
      },
    ]);
    const index = new SearchIndex({
      dbPath: dbPath('search'),
      load: async () => loaded([], 0, new Map()),
      loader: fakeLoader(db),
    });

    const res = await index.search('deploy key', 'fts', 50);
    expect(res.available).toBe(true);
    if (!res.available || res.mode !== 'fts') throw new Error('expected an fts result');
    expect(res.results).toHaveLength(1);
    const hit = res.results[0]!;
    // The raw secret never crosses the wire; a redaction mark + span is present.
    expect(hit.snippet).not.toContain(PLANTED_SECRET);
    expect(hit.snippet).toContain('[REDACTED');
    expect(hit.spans.length).toBeGreaterThan(0);
    expect(hit.sessionId).toBe('s1');
    // The query reached the DB ONLY as a bound MATCH parameter, sanitized.
    expect(db.matchCalls[0]![0]).toBe('"deploy"* "key"*');
  });

  it('an empty / operator-only query returns no hits without touching MATCH', async () => {
    const db = new FakeDb([
      { sessionId: 's', messageIndex: 0, role: 'user', snip: 'x', timestamp: '' },
    ]);
    const index = new SearchIndex({
      dbPath: dbPath('empty'),
      load: async () => loaded([], 0, new Map()),
      loader: fakeLoader(db),
    });
    const res = await index.search('()!!', 'fts', 50);
    if (!res.available || res.mode !== 'fts') throw new Error('expected fts');
    expect(res.results).toEqual([]);
    expect(db.matchCalls).toHaveLength(0);
  });

  it('bounds results and flags truncation', async () => {
    const rows: CannedRow[] = Array.from({ length: 5 }, (_, i) => ({
      sessionId: `s${i}`,
      messageIndex: i,
      role: 'user',
      snip: `hit ${i}`,
      timestamp: '',
    }));
    const index = new SearchIndex({
      dbPath: dbPath('bounded'),
      load: async () => loaded([], 0, new Map()),
      loader: fakeLoader(new FakeDb(rows)),
      maxResults: 2,
    });
    const res = await index.search('hit', 'fts', 2);
    if (!res.available || res.mode !== 'fts') throw new Error('expected fts');
    expect(res.results).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it('status reports coverage, total, and the embeddings flag', async () => {
    const db = new FakeDb();
    const s1 = fakeSession('s1', '/h/s1.jsonl', ['alpha']);
    const index = new SearchIndex({
      dbPath: dbPath('status'),
      load: async () => loaded([s1], 9, new Map([['/h/s1.jsonl', 1]])),
      loader: fakeLoader(db),
      embeddings: true,
    });
    await index.reindex(NOW);
    const st = await index.status(NOW);
    if (!st.available) throw new Error('expected available');
    expect(st.indexed).toEqual({ sessions: 1, messages: 1 });
    expect(st.total).toBe(9);
    expect(st.embeddings.enabled).toBe(true);
    expect(st.lastIndexedAt).toBe(new Date(NOW).toISOString());
  });
});

// ── Embeddings opt-in flag ────────────────────────────────────────────────────

describe('semantic / embeddings flag', () => {
  it('returns a disabled stub when the flag is off (no module needed)', async () => {
    const index = new SearchIndex({
      dbPath: dbPath('sem-off'),
      load: async () => loaded([], 0, new Map()),
      loader: NULL_LOADER, // proves semantic mode never touches the native module
      embeddings: false,
    });
    const res = await index.search('meaning', 'semantic', 50);
    if (!res.available || res.mode !== 'semantic') throw new Error('expected semantic');
    expect(res.semantic).toEqual({ enabled: false, reason: REASON_SEMANTIC_DISABLED });
    expect(res.results).toEqual([]);
  });

  it('returns the not-implemented stub when the flag is on', async () => {
    const index = new SearchIndex({
      dbPath: dbPath('sem-on'),
      load: async () => loaded([], 0, new Map()),
      loader: NULL_LOADER,
      embeddings: true,
    });
    const res = await index.search('meaning', 'semantic', 50);
    if (!res.available || res.mode !== 'semantic') throw new Error('expected semantic');
    expect(res.semantic).toEqual({ enabled: true, reason: REASON_SEMANTIC_STUB });
  });
});

// ── Route wiring on a bare app (logic) ────────────────────────────────────────

describe('search routes', () => {
  function bareApp(loader: SqliteLoader, searchRows: CannedRow[] = []): Hono {
    const app = new Hono();
    const db = new FakeDb(searchRows);
    const s1 = fakeSession('s1', '/h/s1.jsonl', ['alpha beta']);
    registerSearchRoutes(app, {
      home: path.join(base, 'nohome'),
      now: () => NOW,
      loader: loader === NULL_LOADER ? NULL_LOADER : fakeLoader(db),
      indexDir: path.join(base, 'routes-index'),
      // deterministic sessions without a real ~/.claude read:
      // (StatsCache still runs, but the home is empty → zero sessions)
    });
    void s1;
    return app;
  }

  it('GET /api/search degrades to available:false when the module is absent', async () => {
    const app = bareApp(NULL_LOADER);
    const res = await app.fetch(new Request('http://x/api/search?q=hello'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, reason: REASON_NO_MODULE });
  });

  it('GET /api/search returns redacted hits when the index is available', async () => {
    const app = bareApp(fakeLoader(new FakeDb()), [
      {
        sessionId: 's1',
        messageIndex: 1,
        role: 'user',
        snip: `tok ${PLANTED_SECRET}`,
        timestamp: '',
      },
    ]);
    const res = await app.fetch(new Request('http://x/api/search?q=tok'));
    const body = (await res.json()) as { available: boolean; results: { snippet: string }[] };
    expect(body.available).toBe(true);
    expect(body.results[0]?.snippet).not.toContain(PLANTED_SECRET);
  });

  it('GET /api/search/status and POST /api/search/reindex answer without throwing', async () => {
    const app = bareApp(fakeLoader(new FakeDb()));
    const st = await app.fetch(new Request('http://x/api/search/status'));
    expect(st.status).toBe(200);
    const re = await app.fetch(new Request('http://x/api/search/reindex', { method: 'POST' }));
    const body = (await re.json()) as { available: boolean };
    expect(body.available).toBe(true);
  });
});

// ── Full app boots + search degrades under the real gates ─────────────────────

describe('createApp with search unavailable', () => {
  const PORT = 8931;
  const HOST = `127.0.0.1:${PORT}`;
  const ORIGIN = `http://127.0.0.1:${PORT}`;
  const TOKEN = 'search-session-token-search-session-token-01';
  const tokenHash = createHash('sha256').update(TOKEN).digest();
  const AUTH = { authorization: `Bearer ${TOKEN}` };

  function app(): Hono {
    const registry = new InstanceRegistry('1.0.0');
    const root = path.join(base, 'app-root');
    fs.mkdirSync(root, { recursive: true });
    registry.seed(root, { makeDefault: true });
    return createApp({
      tokenHash,
      port: () => PORT,
      distDir: path.join(base, 'nodist'),
      registry,
      version: '1.0.0',
    });
  }

  it('boots and serves other endpoints while /api/search is unavailable', async () => {
    const a = app();
    // better-sqlite3 is absent in this env → search degrades, server is fine.
    const search = await a.fetch(
      new Request(`http://${HOST}/api/search?q=x`, { headers: { host: HOST, ...AUTH } }),
    );
    expect(search.status).toBe(200);
    expect((await search.json()) as { available: boolean }).toMatchObject({ available: false });

    const health = await a.fetch(
      new Request(`http://${HOST}/api/health`, { headers: { host: HOST, ...AUTH } }),
    );
    expect(health.status).toBe(200);
    const instances = await a.fetch(
      new Request(`http://${HOST}/api/instances`, { headers: { host: HOST, ...AUTH } }),
    );
    expect(instances.status).toBe(200);
  });

  it('/api/search requires the bearer token (inherits the gate)', async () => {
    const a = app();
    const res = await a.fetch(
      new Request(`http://${HOST}/api/search?q=x`, { headers: { host: HOST } }),
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/search/reindex inherits the Origin/CSRF gate', async () => {
    const a = app();
    // No Origin + no Sec-Fetch-Site → rejected even with a valid token.
    const blocked = await a.fetch(
      new Request(`http://${HOST}/api/search/reindex`, {
        method: 'POST',
        headers: { host: HOST, ...AUTH },
      }),
    );
    expect(blocked.status).toBe(403);
    // Same-origin → passes the gate, then degrades (module absent).
    const ok = await a.fetch(
      new Request(`http://${HOST}/api/search/reindex`, {
        method: 'POST',
        headers: { host: HOST, origin: ORIGIN, ...AUTH },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()) as { available: boolean }).toMatchObject({ available: false });
  });
});
