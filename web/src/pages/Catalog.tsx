/**
 * Catalog (route `#/catalog`) — the registry BROWSE + INSTALL experience (SPEC
 * §4.5, §5 row 9). It fetches the merged catalog (entry metadata + this
 * instance's installed records) and presents it as SHELVES of
 * {@link CatalogCard}s — an ARTIFACTS shelf (installable skills/subagents/
 * rules/hooks/commands/mcp-servers) and a RUNTIME SETUP shelf — over a client-
 * side SEARCH + kind/templates FILTER. A kind-scoped QUICK-ADD strip surfaces the
 * reusable {@link QuickAdd} primitive (the same one editor pages import). Each
 * entry's INSTALL/REMOVE runs the guarded dry-run-diff → COMMIT flow; a commit
 * confirms via Toast and refetches so the entry flips between INSTALL and
 * REMOVE live. Console treatment (opendesign/DESIGN.md §5): `.toolbar` search +
 * `.chip` filters, `.card` entries with scope badges and status pills.
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
import { bootstrapToken } from '../api/token.js';
import { ChipRow, EmptyState, SearchInput, useToast } from '../components/core/index.js';
import {
  CatalogCard,
  QuickAdd,
  RuntimeScaffold,
  EMPTY_FILTER,
  INSTALLABLE_KINDS,
  RUNTIME_TEMPLATE_KIND,
  detectedKindSet,
  filterEntries,
  installedByKey,
  installedCount,
  kindsPresent,
  shelveEntries,
  templateCount,
  type CatalogFilter,
} from '../catalog/index.js';
import { useAppState, useReport } from '../state/index.js';
import './catalog.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

type LoadStatus = 'loading' | 'ok' | 'error';

function loadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'unauthorized') return 'Session expired — reopen from the CLI.';
    if (err.kind === 'network') return 'Cannot reach the local server.';
    if (err.kind === 'notfound') return 'No instance selected.';
  }
  return 'Could not load the catalog.';
}

const INSTALLABLE = new Set<string>(INSTALLABLE_KINDS);

function CatalogPage() {
  const toast = useToast();
  const { currentInstance, refetch } = useAppState();
  const { report } = useReport();
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
      setErrMsg('Session token missing.');
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
  // Runtime setups are rendered by the guided RuntimeScaffold section (below), so
  // the generic shelf loop drops the 'runtime' shelf to avoid duplication.
  const shelves = useMemo(
    () => shelveEntries(filtered).filter((s) => s.id !== 'runtime'),
    [filtered],
  );
  const filteredInstalled = useMemo(
    () => installedCount(filtered, installedMap),
    [filtered, installedMap],
  );
  // Detector kinds from the current report drive the "detected in project" state.
  const detected = useMemo(() => detectedKindSet(report?.agents ?? []), [report]);

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
          Catalog
          <span className="catalog__sub meta">
            {currentInstance ? currentInstance.name : 'no instance'}
          </span>
        </h1>
        <p className="page-sub">
          Browse &amp; install skills, subagents, hooks, rules &amp; runtime setup from the registry
          — each with a diff preview and recorded provenance.
        </p>
      </section>

      {status === 'loading' && (
        <section className="page__section">
          <p className="meta">Loading catalog…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="page__section">
          <EmptyState title="No catalog" instruction={errMsg} />
        </section>
      )}

      {status === 'ok' && catalog && client && (
        <>
          {entries.length === 0 ? (
            <section className="page__section">
              <EmptyState instruction="The registry catalog is empty." />
            </section>
          ) : (
            <>
              {/* ── Search + filters ──────────────────────────────────────── */}
              <section className="page__section">
                <div className="toolbar">
                  <SearchInput
                    value={filter.query}
                    onChange={(v) => setFilter((f) => ({ ...f, query: v }))}
                    placeholder="Filter by name, description, tag…"
                    label="search catalog"
                  />
                  <ChipRow
                    label="filter by kind"
                    options={[
                      ...allKinds
                        .filter((kind) => kind !== RUNTIME_TEMPLATE_KIND)
                        .map((kind) => ({ value: kind, label: kind })),
                      // The templates toggle rides in the same chip track; its
                      // pseudo-value never collides (RUNTIME_TEMPLATE_KIND kinds
                      // are filtered out above).
                      ...(templates > 0 ? [{ value: 'templates', label: 'templates' }] : []),
                    ]}
                    values={[...filter.kinds, ...(filter.templatesOnly ? ['templates'] : [])]}
                    onToggle={(value) => {
                      if (value === 'templates')
                        setFilter((f) => ({ ...f, templatesOnly: !f.templatesOnly }));
                      else toggleKind(value);
                    }}
                  />
                  {filterActive && (
                    <button type="button" className="btn btn-ghost" onClick={clearFilter}>
                      Clear
                    </button>
                  )}
                  <span className="meta" role="status">
                    {filterActive
                      ? `${filtered.length} of ${entries.length} entries`
                      : `${entries.length} entries`}
                    {' · '}
                    {filteredInstalled} installed
                  </span>
                </div>
              </section>

              {/* ── Quick-add strip (reusable primitive; editor pages import it) ── */}
              {quickAddKinds.length > 0 && (
                <section className="page__section catalog__quickadd" aria-label="quick add">
                  <span className="table-header">quick add</span>
                  {quickAddKinds.map((kind) => (
                    <QuickAdd
                      key={kind}
                      kind={kind}
                      client={client}
                      instance={instanceId}
                      entries={entries}
                      installed={installedMap}
                      onChanged={onChanged}
                      onToast={toast}
                    />
                  ))}
                </section>
              )}

              {/* ── Artifact shelves ──────────────────────────────────────── */}
              {shelves.length === 0
                ? filterActive && (
                    <section className="page__section">
                      <EmptyState instruction="No artifacts match this filter." />
                    </section>
                  )
                : shelves.map((shelf) => (
                    <section key={shelf.id} className="page__section catalog__shelf">
                      <div className="catalog__shelf-head">
                        <h2 className="title-section">{shelf.title}</h2>
                        <span className="meta">{shelf.entries.length}</span>
                      </div>
                      <p className="catalog__shelf-note meta">{shelf.note}</p>
                      <ul className="catalog__list">
                        {shelf.entries.map((entry) => (
                          <CatalogCard
                            key={entry.key}
                            entry={entry}
                            installed={installedMap.get(entry.key)}
                            client={client}
                            instance={instanceId}
                            onChanged={onChanged}
                            onToast={toast}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}

              {/* ── Runtime setup (guided scaffolding; ignores the artifact
                  search/filter — it is a small fixed set browsed as a picker) ── */}
              <RuntimeScaffold
                entries={entries}
                installed={installedMap}
                detected={detected}
                client={client}
                instance={instanceId}
                onChanged={onChanged}
                onToast={toast}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}

export function Catalog() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <CatalogPage />;
}
