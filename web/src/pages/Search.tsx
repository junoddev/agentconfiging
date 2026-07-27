/**
 * Search (rail `20 SEARCH`, route `#/search`) — FULL-TEXT SESSION SEARCH over
 * turns + tool results (SPEC §5 row 17, bead 7yb.4). A query box hits GET
 * /api/search (SQLite FTS5), a reindex button rebuilds the index and shows
 * coverage, and a semantic toggle exposes the OPT-IN embeddings mode (a v1 stub).
 *
 * OPTIONAL NATIVE MODULE: the FTS index is backed by the OPTIONAL better-sqlite3
 * module. When it can't load, the server answers `{ available:false, reason }` (a
 * 200) and this page shows a clear "search unavailable — optional dependency not
 * installed" state with a hint — never a crash.
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
import { parseTokenHash } from '../api/token.js';
import { Button, EmptyState } from '../components/core/index.js';
import {
  coverageLine,
  formatWhen,
  hitLabel,
  sessionRefHash,
  snippetSegments,
} from './search/logic.js';
import './search.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

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
    <pre className="mono-data sr__snippet">
      {segments.map((seg, i) =>
        seg.redacted ? (
          <mark key={i} className="sr__redact" title={`redacted: ${seg.id ?? ''}`}>
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
    <li className="sr__hit surface">
      <div className="sr__hit-head micro-label">
        <a className="sr__hit-link" href={sessionRefHash(hit)}>
          {hit.sessionId}
        </a>
        <span className="sr__hit-meta">{hitLabel(hit)}</span>
        {formatWhen(hit.timestamp) !== '' && (
          <span className="sr__hit-when">{formatWhen(hit.timestamp)}</span>
        )}
      </div>
      <Snippet hit={hit} />
    </li>
  );
}

export function Search() {
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);

  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [result, setResult] = useState<SearchResponse | undefined>();
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  const [status, setStatus] = useState<SearchStatusResponse | undefined>();
  const [reindexing, setReindexing] = useState(false);
  const [reindexNote, setReindexNote] = useState('');

  const refreshStatus = useCallback(() => {
    if (!client) return;
    void (async () => {
      try {
        setStatus(await client.getSearchStatus());
      } catch {
        // Non-fatal — the status bar just stays quiet.
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
    setReindexNote('');
    void (async () => {
      try {
        const res: SearchReindexResponse = await client.reindexSearch();
        if (!res.available) {
          setReindexNote(res.reason);
        } else {
          setReindexNote(
            `indexed ${res.indexed.sessions} sessions · ${res.indexed.messages} messages`,
          );
          refreshStatus();
        }
      } catch (err) {
        setReindexNote(loadError(err));
      } finally {
        setReindexing(false);
      }
    })();
  }, [client, refreshStatus]);

  const unavailable = status?.available === false ? status : undefined;
  const available = status?.available === true ? status : undefined;

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">SEARCH</h1>
        <p className="sr__lede micro-label">
          full-text search across this machine&apos;s session turns &amp; tool results — redacted
          snippets, deep-linked to replay
        </p>
      </section>

      {!client && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction="session token missing" />
        </section>
      )}

      {client && unavailable && (
        <section className="page__section">
          <EmptyState
            title="NO INDEX"
            instruction="search unavailable — optional dependency not installed"
          />
          <p className="sr__reason micro-label">{unavailable.reason}</p>
          <p className="sr__hint micro-label">
            install the optional native module to enable search:{' '}
            <span className="mono-data">npm install better-sqlite3</span>
          </p>
        </section>
      )}

      {client && !unavailable && (
        <>
          <section className="page__section sr__controls">
            <div className="sr__searchbar">
              <input
                type="search"
                className="sr__input mono-data"
                placeholder="search turns and tool results…"
                aria-label="search sessions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <Button label="search" variant="primary" onClick={runSearch} disabled={searching} />
            </div>

            <label className="sr__semantic micro-label">
              <input
                type="checkbox"
                checked={semantic}
                onChange={(e) => setSemantic(e.target.checked)}
              />
              semantic (embeddings)
              {available && !available.embeddings.enabled && (
                <span className="sr__flag-off"> — opt-in, not enabled</span>
              )}
            </label>

            <div className="sr__index">
              <Button
                label={reindexing ? 'indexing…' : 'reindex'}
                onClick={reindex}
                disabled={reindexing}
              />
              {available && (
                <span className="sr__coverage micro-label" role="status">
                  {coverageLine(available.indexed, available.total)}
                  {available.lastIndexedAt !== undefined &&
                    ` · last ${formatWhen(available.lastIndexedAt)}`}
                </span>
              )}
              {available === undefined && status === undefined && (
                <span className="sr__coverage micro-label">checking index…</span>
              )}
            </div>
            {reindexNote !== '' && (
              <p className="sr__reindex-note micro-label" role="status">
                {reindexNote}
              </p>
            )}
          </section>

          <section className="page__section sr__results">
            {searching && <p className="micro-label sr__acquiring">SEARCHING</p>}
            {!searching && searchErr !== '' && (
              <EmptyState title="NO SIGNAL" instruction={searchErr} />
            )}
            {!searching && searchErr === '' && result && !result.available && (
              <>
                <EmptyState
                  title="NO INDEX"
                  instruction="search unavailable — optional dependency not installed"
                />
                <p className="sr__reason micro-label">{result.reason}</p>
              </>
            )}
            {!searching &&
              searchErr === '' &&
              result &&
              result.available &&
              result.mode === 'semantic' && (
                <EmptyState
                  title="OFFLINE"
                  instruction={result.semantic?.reason ?? 'semantic search is not available'}
                />
              )}
            {!searching &&
              searchErr === '' &&
              result &&
              result.available &&
              result.mode === 'fts' && (
                <>
                  <p className="sr__summary micro-label" role="status">
                    {result.results.length === 0
                      ? 'no matches'
                      : `${result.results.length}${result.truncated ? '+' : ''} match${
                          result.results.length === 1 ? '' : 'es'
                        }`}
                  </p>
                  {result.results.length > 0 && (
                    <ul className="sr__list">
                      {result.results.map((hit) => (
                        <HitRow key={`${hit.sessionId}:${hit.messageIndex}`} hit={hit} />
                      ))}
                    </ul>
                  )}
                </>
              )}
            {!searching && searchErr === '' && result === undefined && (
              <EmptyState instruction="type a query and press search" />
            )}
          </section>
        </>
      )}
    </main>
  );
}
