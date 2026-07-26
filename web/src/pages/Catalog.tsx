/**
 * Catalog (rail `15 CATALOG`, route `#/catalog`) — the registry BROWSE + INSTALL
 * experience (SPEC §4.5, §5 row 9; DESIGN §6). It fetches the merged catalog
 * (entry metadata + this instance's installed records) and presents it as SHELVES
 * of {@link CatalogCard}s — an ARTIFACTS shelf (installable skills/subagents/
 * rules/hooks/commands/mcp-servers) and a RUNTIME SETUP shelf — over a client-
 * side SEARCH + kind/templates FILTER. A kind-scoped QUICK-ADD strip surfaces the
 * reusable {@link QuickAdd} primitive (the same one editor pages import). Each
 * entry's INSTALL/REMOVE runs the guarded dry-run-diff → COMMIT flow; a commit
 * refetches so the entry flips between INSTALL and REMOVE live.
 *
 * SECURITY POSTURE (client side): registry content is UNTRUSTED. This page never
 * fetches or renders file BODIES itself — it shows metadata and the server's
 * dry-run DIFF (parsed + rendered as text nodes by DiffPanel). Every registry
 * field is a text node; all writes go through the server's guard + provenance.
 *
 * CLIENT SEAM: like Settings/Sync, the shell keeps its ApiClient private, so this
 * page captures the launch token at module load and builds its own client. It
 * calls the shell's refetch() after a commit so any resolved findings drop out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type CatalogResponse } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { EmptyState } from '../components/core/index.js';
import {
  CatalogCard,
  QuickAdd,
  EMPTY_FILTER,
  INSTALLABLE_KINDS,
  filterEntries,
  installedByKey,
  installedCount,
  kindsPresent,
  shelveEntries,
  templateCount,
  type CatalogFilter,
} from '../catalog/index.js';
import { useAppState } from '../state/index.js';
import './catalog.css';

const bootToken =
  typeof window !== 'undefined' ? parseTokenHash(window.location.hash).token : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'session expired — reopen from the CLI';
    if (err.kind === 'network') return 'cannot reach the local server';
    if (err.kind === 'notfound') return 'no instance selected';
  }
  return 'could not load the catalog';
}

const INSTALLABLE = new Set<string>(INSTALLABLE_KINDS);

export function Catalog() {
  const { currentInstance, refetch } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;

  const [catalog, setCatalog] = useState<CatalogResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

  const [filter, setFilter] = useState<CatalogFilter>(EMPTY_FILTER);

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setStatus('error');
      setErrMsg('session token missing');
      return;
    }
    setStatus('loading');
    void (async () => {
      try {
        const res = await client.getCatalog(instanceId);
        if (cancelled) return;
        setCatalog(res);
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setErrMsg(loadError(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, instanceId, reloadKey]);

  // After a commit: pull the fresh report (resolved findings drop out) and
  // re-fetch the catalog so the entry flips between INSTALL and REMOVE.
  const onChanged = useCallback(() => {
    refetch();
    setReloadKey((k) => k + 1);
  }, [refetch]);

  const entries = catalog?.entries ?? [];
  const installedMap = useMemo(() => installedByKey(catalog?.installed ?? []), [catalog]);

  const allKinds = useMemo(() => kindsPresent(entries), [entries]);
  const templates = useMemo(() => templateCount(entries), [entries]);
  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const shelves = useMemo(() => shelveEntries(filtered), [filtered]);
  const filteredInstalled = useMemo(
    () => installedCount(filtered, installedMap),
    [filtered, installedMap],
  );

  const toggleKind = useCallback((kind: string) => {
    setFilter((f) => ({
      ...f,
      kinds: f.kinds.includes(kind) ? f.kinds.filter((k) => k !== kind) : [...f.kinds, kind],
    }));
  }, []);

  const filterActive =
    filter.query.trim() !== '' || filter.kinds.length > 0 || filter.templatesOnly;

  const clearFilter = useCallback(() => setFilter(EMPTY_FILTER), []);

  // Installable kinds actually present — drives the quick-add strip.
  const quickAddKinds = useMemo(() => allKinds.filter((k) => INSTALLABLE.has(k)), [allKinds]);

  return (
    <main className="layout-main page">
      <section className="page__section">
        <h1 className="title-page">
          CATALOG
          <span className="catalog__sub micro-label">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
        <p className="catalog__lede micro-label">
          browse &amp; install skills, subagents, hooks, rules &amp; runtime setup from the registry
          — each with a diff preview and recorded provenance
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="micro-label">loading catalog…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="NO SIGNAL" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && catalog && client && (
        <>
          {entries.length === 0 ? (
            <section className="page__section">
              <EmptyState instruction="the registry catalog is empty" />
            </section>
          ) : (
            <>
              {/* ── Search + filters ──────────────────────────────────────── */}
              <section className="page__section catalog__controls">
                <input
                  type="search"
                  className="catalog__search mono-data"
                  placeholder="search name, description, tags…"
                  aria-label="search catalog"
                  value={filter.query}
                  onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                />
                <div className="catalog__chips" role="group" aria-label="filter by kind">
                  {allKinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="catalog-chip micro-label"
                      aria-pressed={filter.kinds.includes(kind)}
                      onClick={() => toggleKind(kind)}
                    >
                      {kind}
                    </button>
                  ))}
                  {templates > 0 && (
                    <button
                      type="button"
                      className="catalog-chip micro-label"
                      aria-pressed={filter.templatesOnly}
                      onClick={() => setFilter((f) => ({ ...f, templatesOnly: !f.templatesOnly }))}
                    >
                      templates
                    </button>
                  )}
                  {filterActive && (
                    <button
                      type="button"
                      className="catalog-chip catalog-chip--clear micro-label"
                      onClick={clearFilter}
                    >
                      clear
                    </button>
                  )}
                </div>
                <p className="catalog__summary micro-label" role="status">
                  {filterActive
                    ? `${filtered.length} of ${entries.length} entries`
                    : `${entries.length} entries`}
                  {' · '}
                  {filteredInstalled} installed
                </p>
              </section>

              {/* ── Quick-add strip (reusable primitive; editor pages import it) ── */}
              {quickAddKinds.length > 0 && (
                <section className="page__section catalog__quickadd" aria-label="quick add">
                  <span className="catalog__quickadd-label micro-label">QUICK ADD</span>
                  {quickAddKinds.map((kind) => (
                    <QuickAdd
                      key={kind}
                      kind={kind}
                      client={client}
                      instance={instanceId}
                      entries={entries}
                      installed={installedMap}
                      onChanged={onChanged}
                    />
                  ))}
                </section>
              )}

              {/* ── Shelves ───────────────────────────────────────────────── */}
              {shelves.length === 0 ? (
                <section className="page__section">
                  <EmptyState instruction="no entries match this filter" />
                </section>
              ) : (
                shelves.map((shelf) => (
                  <section key={shelf.id} className="page__section catalog__shelf">
                    <div className="catalog__shelf-head">
                      <h2 className="catalog__shelf-title">{shelf.title}</h2>
                      <span className="catalog__shelf-count micro-label">
                        {shelf.entries.length}
                      </span>
                    </div>
                    <p className="catalog__shelf-note micro-label">{shelf.note}</p>
                    <ul className="catalog__list">
                      {shelf.entries.map((entry) => (
                        <CatalogCard
                          key={entry.key}
                          entry={entry}
                          installed={installedMap.get(entry.key)}
                          client={client}
                          instance={instanceId}
                          onChanged={onChanged}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
