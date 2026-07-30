/**
 * Search (route `#/search`) — FULL-TEXT SESSION SEARCH over turns + tool
 * results (SPEC §5 row 17, bead 7yb.4). A query box hits GET /api/search
 * (SQLite FTS5), a reindex button rebuilds the index and shows coverage, and a
 * semantic toggle exposes the OPT-IN embeddings mode (a v1 stub).
 *
 * OPTIONAL NATIVE MODULE: the FTS index is backed by the OPTIONAL better-sqlite3
 * module. When it can't load, the server answers `{ available:false, reason }` (a
 * 200) and this page shows the capability gap as a Console notice with the
 * install hint — never a crash.
 *
 * ADVERSARIAL CONTENT (SPEC §3): result snippets are REDACTED server-side
 * (`[REDACTED:*]` marks) before they cross the wire, so a raw secret never reaches
 * the browser. Every string here is rendered as a TEXT NODE — never HTML.
 *
 * CLIENT SEAM: like Sessions/Marketplace, the shell keeps its ApiClient private,
 * so this page captures the launch token at module load and builds its own client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiClient,
  ApiError,
  type SearchHit,
  type SearchReindexResponse,
  type SearchResponse,
  type SearchStatusResponse,
} from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { Button, EmptyState, Notice, Switch, useToast } from '../components/core/index.js';
import {
  coverageLine,
  formatWhen,
  hitLabel,
  sessionRefHash,
  snippetSegments,
} from './search/logic.js';
import './search.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

/** Result cap requested per query (matches the server default). */
const LIMIT = 50;

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
  }
  return 'could not run the search';
}

/** Redacted snippet → text nodes with styled `[REDACTED:*]` marks. Content is
 *  already redacted server-side, so no secret is present to leak. */
function Snippet({ hit }: { hit: SearchHit }) {
  const segments = snippetSegments(hit.snippet, hit.spans);
  return (
    <pre className="mono-data sr-snippet">
      {segments.map((seg, i) =>
        seg.redacted ? (
          <mark key={i} className="sr-redact" title={`redacted: ${seg.id ?? ''}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </pre>
  );
}

function HitRow({ hit }: { hit: SearchHit }) {
  return (
    <li className="sr-hit">
      <div className="sr-hit-head">
        <a className="mono-data sr-hit-link" href={sessionRefHash(hit)}>
          {hit.sessionId}
        </a>
        <span className="meta">{hitLabel(hit)}</span>
        {formatWhen(hit.timestamp) !== '' && (
          <span className="meta">{formatWhen(hit.timestamp)}</span>
        )}
      </div>
      <Snippet hit={hit} />
    </li>
  );
}

/** The capability-gap notice (§7: say what's missing + the nearest fix). */
function UnavailableNotice({ reason }: { reason: string }) {
  return (
    <Notice>
      Search is unavailable — the optional native module is not installed ({reason}). Enable it with{' '}
      <span className="code">npm install better-sqlite3</span>.
    </Notice>
  );
}

function SearchPanel() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const toast = useToast();

  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [result, setResult] = useState<SearchResponse | undefined>();
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const [status, setStatus] = useState<SearchStatusResponse | undefined>();
  const [reindexing, setReindexing] = useState(false);
  const [reindexErr, setReindexErr] = useState('');

  const refreshStatus = useCallback(() => {
    if (!client) return;
    void (async () => {
      try {
        setStatus(await client.getSearchStatus());
      } catch {
        // Non-fatal — the coverage line just stays quiet.
      }
    })();
  }, [client]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const runSearch = useCallback(() => {
    if (!client || query.trim() === '') return;
    setSearching(true);
    setSearchErr('');
    void (async () => {
      try {
        const res = await client.searchSessions(query, {
          mode: semantic ? 'semantic' : 'fts',
          limit: LIMIT,
        });
        setResult(res);
      } catch (err) {
        setSearchErr(loadError(err));
      } finally {
        setSearching(false);
      }
    })();
  }, [client, query, semantic]);

  const reindex = useCallback(() => {
    if (!client) return;
    setReindexing(true);
    setReindexErr('');
    void (async () => {
      try {
        const res: SearchReindexResponse = await client.reindexSearch();
        if (!res.available) {
          setReindexErr(res.reason);
        } else {
          toast(`Reindexed — ${res.indexed.sessions} sessions · ${res.indexed.messages} messages`);
          refreshStatus();
        }
      } catch (err) {
        setReindexErr(loadError(err));
      } finally {
        setReindexing(false);
      }
    })();
  }, [client, refreshStatus, toast]);

  const unavailable = status?.available === false ? status : undefined;
  const available = status?.available === true ? status : undefined;

  return (
    <main className="layout-main page">
      <section className="page__section">
        <div className="page-head">
          <div>
            <h1>Search</h1>
            <p className="page-sub">
              Full-text search across this machine&apos;s session turns &amp; tool results —
              redacted snippets, deep-linked to replay.
            </p>
          </div>
        </div>
      </section>

      {!client && (
        <section className="page__section">
          <EmptyState
            title="No session"
            instruction="session token missing — reopen agentconfig from the CLI"
          />
        </section>
      )}

      {client && unavailable && (
        <section className="page__section">
          <UnavailableNotice reason={unavailable.reason} />
        </section>
      )}

      {client && !unavailable && (
        <>
          <section className="page__section sr-controls">
            <div className="sr-bar">
              <input
                type="search"
                className="search sr-input"
                placeholder="Search turns and tool results…"
                aria-label="search sessions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <Button label="Search" variant="primary" onClick={runSearch} disabled={searching} />
            </div>

            <div className="sr-semantic">
              <Switch on={semantic} onChange={setSemantic} label="semantic search (embeddings)" />
              <span className="meta">
                semantic (embeddings)
                {available && !available.embeddings.enabled && ' — opt-in, not enabled'}
              </span>
            </div>

            <div className="sr-index">
              <Button
                label={reindexing ? 'Indexing…' : 'Reindex'}
                onClick={reindex}
                disabled={reindexing}
              />
              {available && (
                <span className="meta" role="status">
                  {coverageLine(available.indexed, available.total)}
                  {available.lastIndexedAt !== undefined &&
                    ` · last ${formatWhen(available.lastIndexedAt)}`}
                </span>
              )}
              {available === undefined && status === undefined && (
                <span className="meta">checking index…</span>
              )}
            </div>
            {reindexErr !== '' && (
              <Notice>
                <span role="status">{reindexErr}</span>
              </Notice>
            )}
          </section>

          <section className="page__section sr-results">
            {searching && <p className="meta">searching…</p>}
            {!searching && searchErr !== '' && (
              <EmptyState title="Search failed" instruction={searchErr} />
            )}
            {!searching && searchErr === '' && result && !result.available && (
              <UnavailableNotice reason={result.reason} />
            )}
            {!searching &&
              searchErr === '' &&
              result &&
              result.available &&
              result.mode === 'semantic' && (
                <Notice tone="info">
                  {result.semantic?.reason ?? 'semantic search is not available'}
                </Notice>
              )}
            {!searching &&
              searchErr === '' &&
              result &&
              result.available &&
              result.mode === 'fts' && (
                <>
                  <p className="meta sr-summary" role="status">
                    {result.results.length === 0
                      ? `no matches for "${result.query}"`
                      : `${result.results.length}${result.truncated ? '+' : ''} match${
                          result.results.length === 1 ? '' : 'es'
                        }`}
                  </p>
                  {result.results.length > 0 && (
                    <ul className="sr-list">
                      {result.results.map((hit) => (
                        <HitRow key={`${hit.sessionId}:${hit.messageIndex}`} hit={hit} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            {!searching && searchErr === '' && result === undefined && (
              <EmptyState instruction="type a query and press Search" />
            )}
          </section>
        </>
      )}
    </main>
  );
}

export function Search() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <SearchPanel />;
}
