/**
 * Catalog (rail `15 CATALOG`, route `#/catalog`, bead agentconfig-0zm.4) — the
 * registry INSTALL/REMOVE surface (SPEC §4.5). It browses the merged catalog
 * (seed floor + fetched overlay) as {@link CatalogCard}s and drives each entry's
 * dry-run-diff → COMMIT install / remove flow through the guarded server catalog
 * endpoints. A minimal browse surface intentionally — the full shelves/search UI
 * is bead 0zm.3; this focuses on the install/remove flow and provenance state.
 *
 * SECURITY POSTURE (client side): registry content is UNTRUSTED. This page never
 * fetches or renders file BODIES itself — it shows metadata and the server's
 * dry-run DIFF (parsed + rendered as text nodes by DiffPanel). All install/remove
 * writes go through the server's path-guard + checksum + provenance discipline.
 *
 * CLIENT SEAM: like Settings/Sync, the shell keeps its ApiClient private, so this
 * page captures the launch token at module load and builds its own client. It
 * calls the shell's refetch() after a commit so any resolved findings drop out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient, ApiError, type CatalogResponse } from '../api/index.js';
import { parseTokenHash } from '../api/token.js';
import { EmptyState } from '../components/core/index.js';
import { CatalogCard } from '../catalog/index.js';
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

export function Catalog() {
  const { currentInstance, refetch } = useAppState();
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const instanceId = currentInstance?.id;

  const [catalog, setCatalog] = useState<CatalogResponse | undefined>();
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [errMsg, setErrMsg] = useState<string>('');
  const [reloadKey, setReloadKey] = useState(0);

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

  const installedByKey = useMemo(() => {
    const map = new Map<string, CatalogResponse['installed'][number]>();
    for (const rec of catalog?.installed ?? []) map.set(rec.key, rec);
    return map;
  }, [catalog]);

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
          install skills, subagents, hooks &amp; rules from the registry — each with a diff preview
          and recorded provenance
        </p>
      </section>

      <section className="page__section">
        {status === 'loading' && <p className="micro-label">loading catalog…</p>}
        {status === 'error' && <EmptyState title="NO SIGNAL" instruction={errMsg} />}

        {status === 'ok' && catalog && client && (
          <>
            <p className="catalog__summary micro-label" role="status">
              {catalog.entries.length} entries · {installedByKey.size} installed
            </p>
            {catalog.entries.length === 0 ? (
              <EmptyState instruction="the registry catalog is empty" />
            ) : (
              <ul className="catalog__list">
                {catalog.entries.map((entry) => (
                  <CatalogCard
                    key={entry.key}
                    entry={entry}
                    installed={installedByKey.get(entry.key)}
                    client={client}
                    instance={instanceId}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
